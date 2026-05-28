import {
  PostgresHandoffRepository,
  PostgresAgentDefinitionRepository,
  PostgresModelRegistryRepository,
  PostgresNamespaceSecretsRepository,
  PostgresWorkflowSecretsRepository,
  PostgresToolCatalogRepository,
  PostgresNamespaceRepository,
  PostgresAuditRepository,
  PostgresOAuthProviderRepository,
  PostgresAgentOAuthTokenRepository,
  PostgresCronTriggerStateRepository,
  PostgresAgentRunRepository,
  PostgresHumanTaskRepository,
  PostgresCoworkSessionRepository,
  PostgresProcessInstanceRepository,
  PostgresProcessRepository,
  PostgresAgentEventLog,
  getSharedPostgresClient,
  FirebaseInviteService,
  getAdminFirestore,
  validateSecretsKey,
  createMailgunSender,
  MailgunNotificationService,
  FirebaseUserDirectoryService,
  getAdminAuth,
} from '@mediforce/platform-infra';
import type {
  AgentDefinitionRepository,
  AgentOAuthTokenRepository,
  AgentRunRepository,
  AuditRepository,
  CoworkSessionRepository,
  CronTriggerStateRepository,
  HandoffRepository,
  HumanTaskRepository,
  ModelRegistryRepository,
  NamespaceRepository,
  NamespaceSecretsRepository,
  OAuthProviderRepository,
  ProcessInstanceRepository,
  ProcessRepository,
  SendEmailFn,
  ToolCatalogRepository,
  UserDirectoryService,
  WorkflowSecretsRepository,
} from '@mediforce/platform-core';
import {
  ContainerWorkerDockerImagesService,
  LocalDockerImagesService,
  isLocalAgentMode,
  type DockerImagesService,
} from './docker-images-service.js';
import { sendInviteEmail, sendWorkspaceNotificationEmail } from './invite-emails.js';
import type {
  InviteNotificationService,
  InviteService,
  InvitedUser,
  SendInviteEmailInput,
  SendWorkspaceNotificationEmailInput,
} from './invite-notification.js';
import {
  WorkflowEngine,
  ManualTrigger,
  CronTrigger,
} from '@mediforce/workflow-engine';
import {
  AgentRunner,
  PluginRegistry,
  OpenRouterLlmClient,
  ClaudeCodeAgentPlugin,
  MockClaudeCodeAgentPlugin,
  OpenCodeAgentPlugin,
  ScriptContainerPlugin,
} from '@mediforce/agent-runtime';
import {
  ActionRegistry,
  httpActionHandler,
  reshapeActionHandler,
  createSpawnActionHandler,
  createEmailActionHandler,
  waitActionHandler,
} from '@mediforce/core-actions';
import { WebhookRouter } from '@mediforce/workflow-engine';
import { seedBuiltinAgentDefinitions } from './seed-agent-definitions.js';
import { seedBuiltinToolCatalog } from './seed-tool-catalog.js';

let services: PlatformServices | null = null;
let seedingStarted = false;

export interface PlatformServices {
  engine: WorkflowEngine;
  manualTrigger: ManualTrigger;
  cronTrigger: CronTrigger;
  webhookRouter: WebhookRouter;
  actionRegistry: ActionRegistry;
  agentRunner: AgentRunner;
  pluginRegistry: PluginRegistry;
  llmClient: OpenRouterLlmClient;
  processRepo: ProcessRepository;
  instanceRepo: ProcessInstanceRepository;
  auditRepo: AuditRepository;
  agentRunRepo: AgentRunRepository;
  humanTaskRepo: HumanTaskRepository;
  handoffRepo: HandoffRepository;
  agentDefinitionRepo: AgentDefinitionRepository;
  coworkSessionRepo: CoworkSessionRepository;
  cronTriggerStateRepo: CronTriggerStateRepository;
  toolCatalogRepo: ToolCatalogRepository;
  namespaceRepo: NamespaceRepository;
  oauthProviderRepo: OAuthProviderRepository;
  agentOAuthTokenRepo: AgentOAuthTokenRepository;
  modelRegistryRepo: ModelRegistryRepository;
  secretsRepo: WorkflowSecretsRepository;
  namespaceSecretsRepo: NamespaceSecretsRepository;
  inviteService: InviteService;
  /** `null` when Mailgun env vars are unset (email disabled). */
  inviteNotificationService: InviteNotificationService | null;
  dockerImages: DockerImagesService;
  /**
   * Firebase Auth metadata lookup (uid → email, lastSignInTime). Always wired
   * in production (depends on Firebase Auth, not Mailgun). Handlers consume
   * via `scope.system.userDirectory`.
   */
  userDirectory: UserDirectoryService;
}

/**
 * Narrow ports used by the invite-service adapter. Defined here so this file
 * doesn't import `firebase-admin/*` directly — that dependency stays inside
 * `platform-infra`. `getAdminAuth()` returns an `Auth` that satisfies the
 * `AuthPort` shape structurally.
 */
interface UserRecordPort {
  readonly email?: string;
  readonly metadata: { readonly lastSignInTime: string | null };
}
interface AuthPort {
  getUser(uid: string): Promise<UserRecordPort>;
}
interface DocSnapshotPort {
  readonly exists: boolean;
  data(): { readonly mustChangePassword?: boolean } | undefined;
}
interface DocRefPort {
  get(): Promise<DocSnapshotPort>;
}
interface CollectionPort {
  doc(id: string): DocRefPort;
}
interface FirestorePort {
  collection(name: string): CollectionPort;
}

/**
 * Adapts `FirebaseInviteService` onto the framework-free `InviteService`
 * interface that handlers consume. Adds read-side methods (`getUserEmail`,
 * `isInvitePending`) directly here so the Firebase service stays focused on
 * writes.
 */
class FirebaseInviteServiceAdapter implements InviteService {
  constructor(
    private readonly firebase: FirebaseInviteService,
    private readonly adminAuth: AuthPort,
    private readonly adminDb: FirestorePort,
  ) {}

  async createInvitedUser(email: string, displayName: string | undefined): Promise<InvitedUser> {
    return this.firebase.createInvitedUser(email, displayName, undefined);
  }

  async resetInvitePassword(uid: string): Promise<string> {
    return this.firebase.resetInvitePassword(uid);
  }

  async getUserEmail(uid: string): Promise<string | null> {
    try {
      const record = await this.adminAuth.getUser(uid);
      const email = record.email;
      return typeof email === 'string' && email !== '' ? email : null;
    } catch {
      return null;
    }
  }

  async isInvitePending(uid: string): Promise<boolean> {
    let lastSignInTime: string | null = '';
    try {
      const record = await this.adminAuth.getUser(uid);
      lastSignInTime = record.metadata.lastSignInTime;
    } catch {
      // Treat unknown users as not pending — handlers will surface a 404.
      return false;
    }
    const userDoc = await this.adminDb.collection('users').doc(uid).get();
    const mustChangePassword = userDoc.exists ? userDoc.data()?.mustChangePassword === true : false;
    const hasNeverSignedIn = lastSignInTime === null || lastSignInTime === '';
    return mustChangePassword || hasNeverSignedIn;
  }
}

/**
 * Adapts the Mailgun `SendEmailFn` into the `InviteNotificationService`
 * interface — delegates to the existing pure email-body helpers and supplies
 * deployment config (app URL, sender name) so handlers never see env vars.
 */
class MailgunInviteNotificationService implements InviteNotificationService {
  constructor(
    private readonly sendEmail: SendEmailFn,
    private readonly appUrl: string,
    private readonly senderName: string,
  ) {}

  async sendInviteEmail(input: SendInviteEmailInput): Promise<void> {
    await sendInviteEmail(
      { ...input, appUrl: this.appUrl, senderName: this.senderName },
      this.sendEmail,
    );
  }

  async sendWorkspaceNotificationEmail(input: SendWorkspaceNotificationEmailInput): Promise<void> {
    await sendWorkspaceNotificationEmail(
      {
        toEmail: input.toEmail,
        inviterName: input.inviterName,
        workspaceName: input.workspaceName,
        workspaceUrl: `${this.appUrl}/${input.workspaceHandle}`,
        appUrl: this.appUrl,
        senderName: this.senderName,
      },
      this.sendEmail,
    );
  }
}

export function getPlatformServices(): PlatformServices {
  if (services) return services;

  // Fail fast if the encryption key is missing or malformed — better to crash here
  // than to boot successfully and fail opaquely mid-workflow.
  validateSecretsKey();

  const pg = getSharedPostgresClient().db;

  const processRepo: ProcessRepository = new PostgresProcessRepository(pg);
  const instanceRepo: PostgresProcessInstanceRepository =
    new PostgresProcessInstanceRepository(pg);
  // Indirect-namespace repos depend on instanceRepo for parent-run namespace
  // resolution inside the namespace-scoped read variants (ADR-0004 §"Storage-
  // layer filter, today").
  const auditRepo: AuditRepository = new PostgresAuditRepository(pg, instanceRepo);
  const agentRunRepo: AgentRunRepository = new PostgresAgentRunRepository(pg, instanceRepo);
  const humanTaskRepo: HumanTaskRepository = new PostgresHumanTaskRepository(pg, instanceRepo);
  const handoffRepo: HandoffRepository = new PostgresHandoffRepository(pg, instanceRepo);
  const agentDefinitionRepo: AgentDefinitionRepository = new PostgresAgentDefinitionRepository(pg);
  const coworkSessionRepo: CoworkSessionRepository =
    new PostgresCoworkSessionRepository(pg, instanceRepo);
  const cronTriggerStateRepo: CronTriggerStateRepository =
    new PostgresCronTriggerStateRepository(pg);
  const toolCatalogRepo: ToolCatalogRepository = new PostgresToolCatalogRepository(pg);
  const namespaceRepo: NamespaceRepository = new PostgresNamespaceRepository(pg);
  const oauthProviderRepo: OAuthProviderRepository = new PostgresOAuthProviderRepository(pg);
  const agentOAuthTokenRepo: AgentOAuthTokenRepository =
    new PostgresAgentOAuthTokenRepository(pg);
  const modelRegistryRepo: ModelRegistryRepository = new PostgresModelRegistryRepository(pg);
  const secretsRepo: WorkflowSecretsRepository = new PostgresWorkflowSecretsRepository(pg);
  const namespaceSecretsRepo: NamespaceSecretsRepository =
    new PostgresNamespaceSecretsRepository(pg);
  const eventLog = new PostgresAgentEventLog(instanceRepo);

  const pluginRegistry = new PluginRegistry();

  const useMockAgent = process.env.MOCK_AGENT === 'true';
  if (useMockAgent) {
    console.log('[platform-services] MOCK_AGENT=true — using MockClaudeCodeAgentPlugin');
  }
  pluginRegistry.register(
    'claude-code-agent',
    useMockAgent ? new MockClaudeCodeAgentPlugin() : new ClaudeCodeAgentPlugin(),
  );

  pluginRegistry.register('opencode-agent', new OpenCodeAgentPlugin());
  pluginRegistry.register('script-container', new ScriptContainerPlugin());

  const llmClient = new OpenRouterLlmClient(
    process.env.OPENROUTER_API_KEY ?? '',
    'anthropic/claude-sonnet-4',
  );

  const emailDisabled = process.env.MEDIFORCE_DISABLE_EMAIL === 'true';
  const mailgunApiKey = process.env.MAILGUN_API_KEY ?? '';
  const mailgunDomain = process.env.MAILGUN_DOMAIN ?? '';
  const mailgunFrom = process.env.MAILGUN_FROM_EMAIL ?? '';
  const mailgunSenderName = process.env.MAILGUN_SENDER_NAME ?? 'Mediforce';

  const mailgunConfigured = mailgunApiKey !== '' && mailgunDomain !== '' && mailgunFrom !== '';
  if (!emailDisabled && !mailgunConfigured) {
    const missing = [
      !mailgunApiKey && 'MAILGUN_API_KEY',
      !mailgunDomain && 'MAILGUN_DOMAIN',
      !mailgunFrom && 'MAILGUN_FROM_EMAIL',
    ].filter(Boolean).join(', ');
    throw new Error(
      `Email is enabled but Mailgun config incomplete (missing: ${missing}). ` +
      `Set the env vars or set MEDIFORCE_DISABLE_EMAIL=true to start without email.`,
    );
  }
  if (emailDisabled) {
    console.log('[platform-services] MEDIFORCE_DISABLE_EMAIL=true — email handler and notifications disabled');
  }

  const mailgunSender = mailgunConfigured
    ? createMailgunSender({
        apiKey: mailgunApiKey,
        domain: mailgunDomain,
        defaultFrom: mailgunFrom,
        defaultSenderName: mailgunSenderName,
      })
    : undefined;

  const notificationService = mailgunSender
    ? new MailgunNotificationService(mailgunSender)
    : undefined;
  // Wired whenever Firebase Auth is available — independent of Mailgun.
  // Email-disabled deployments still need uid → email/lastSignInTime lookups
  // for the namespace-members endpoint.
  const userDirectoryService: UserDirectoryService = new FirebaseUserDirectoryService(
    getAdminAuth(),
  );

  const engine = new WorkflowEngine(
    processRepo,
    instanceRepo,
    auditRepo,
    undefined,
    undefined,
    notificationService,
    humanTaskRepo,
    coworkSessionRepo,
    userDirectoryService,
  );

  const agentRunner = new AgentRunner(
    instanceRepo,
    auditRepo,
    eventLog,
    agentRunRepo,
  );

  const manualTrigger = new ManualTrigger(engine, processRepo);

  const actionRegistry = new ActionRegistry();
  actionRegistry.register('http', httpActionHandler);
  actionRegistry.register('reshape', reshapeActionHandler);
  actionRegistry.register('spawn', createSpawnActionHandler(manualTrigger, processRepo));
  actionRegistry.register('wait', waitActionHandler);
  if (mailgunSender) {
    actionRegistry.register('email', createEmailActionHandler(mailgunSender));
  }

  const webhookRouter = new WebhookRouter(engine, processRepo);

  // FirebaseInviteService writes to the Firebase Auth user store and the
  // `users` Firestore collection. Auth state and the user docs remain on
  // Firebase post-PR2 (only workflow data moved to Postgres), so the
  // Firestore handle is still required for invite operations.
  const adminAuth = getAdminAuth();
  const adminDb = getAdminFirestore();
  const firebaseInvite = new FirebaseInviteService(adminAuth, adminDb);
  const inviteService = new FirebaseInviteServiceAdapter(firebaseInvite, adminAuth, adminDb);
  // `appUrl` matches the legacy invite route's fallback so dev-without-
  // NEXT_PUBLIC_PLATFORM_URL still renders sensible links.
  const inviteAppUrl =
    process.env.NEXT_PUBLIC_PLATFORM_URL ?? `http://localhost:${process.env.PORT ?? '3000'}`;
  const inviteNotificationService = mailgunSender
    ? new MailgunInviteNotificationService(mailgunSender, inviteAppUrl, mailgunSenderName)
    : null;

  const dockerImages: DockerImagesService = isLocalAgentMode()
    ? new LocalDockerImagesService()
    : new ContainerWorkerDockerImagesService(
        process.env.CONTAINER_WORKER_URL ?? 'http://container-worker:3001',
        process.env.CONTAINER_WORKER_SECRET,
      );

  services = {
    engine,
    manualTrigger,
    cronTrigger: new CronTrigger(engine),
    webhookRouter,
    actionRegistry,
    agentRunner,
    pluginRegistry,
    llmClient,
    processRepo,
    instanceRepo,
    auditRepo,
    agentRunRepo,
    humanTaskRepo,
    handoffRepo,
    agentDefinitionRepo,
    coworkSessionRepo,
    cronTriggerStateRepo,
    toolCatalogRepo,
    namespaceRepo,
    oauthProviderRepo,
    agentOAuthTokenRepo,
    modelRegistryRepo,
    secretsRepo,
    namespaceSecretsRepo,
    inviteService,
    inviteNotificationService,
    dockerImages,
    userDirectory: userDirectoryService,
  };

  if (!seedingStarted) {
    seedingStarted = true;
    seedBuiltinAgentDefinitions(agentDefinitionRepo).catch((err) => {
      console.error('[platform-services] Failed to seed built-in agent definitions:', err);
    });
    seedBuiltinToolCatalog(toolCatalogRepo).catch((err) => {
      console.error('[platform-services] Failed to seed built-in tool catalog:', err);
    });
  }

  return services;
}
