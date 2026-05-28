import {
  FirestoreProcessRepository,
  FirestoreProcessInstanceRepository,
  FirestoreAuditRepository,
  FirestoreAgentRunRepository,
  FirestoreHumanTaskRepository,
  FirestoreHandoffRepository,
  FirestoreAgentDefinitionRepository,
  FirestoreCoworkSessionRepository,
  FirestoreCronTriggerStateRepository,
  FirestoreToolCatalogRepository,
  FirestoreNamespaceRepository,
  FirestoreUserProfileRepository,
  FirestoreOAuthProviderRepository,
  FirestoreAgentOAuthTokenRepository,
  FirestoreModelRegistryRepository,
  FirestoreWorkflowSecretsRepository,
  FirestoreNamespaceSecretsRepository,
  FirebaseInviteService,
  PostgresToolCatalogRepository,
  getSharedPostgresClient,
  getAdminFirestore,
  validateSecretsKey,
  createMailgunSender,
  MailgunNotificationService,
  FirebaseUserDirectoryService,
  getAdminAuth,
} from '@mediforce/platform-infra';
import type { SendEmailFn, UserDirectoryService } from '@mediforce/platform-core';
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
import type {
  CronTriggerStateRepository,
  ToolCatalogRepository,
} from '@mediforce/platform-core';
import {
  WorkflowEngine,
  ManualTrigger,
  CronTrigger,
} from '@mediforce/workflow-engine';
import {
  AgentRunner,
  PluginRegistry,
  OpenRouterLlmClient,
  FirestoreAgentEventLog,
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
import { backfillInstanceNamespaces } from '@mediforce/platform-infra';

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
  processRepo: FirestoreProcessRepository;
  instanceRepo: FirestoreProcessInstanceRepository;
  auditRepo: FirestoreAuditRepository;
  agentRunRepo: FirestoreAgentRunRepository;
  humanTaskRepo: FirestoreHumanTaskRepository;
  handoffRepo: FirestoreHandoffRepository;
  agentDefinitionRepo: FirestoreAgentDefinitionRepository;
  coworkSessionRepo: FirestoreCoworkSessionRepository;
  cronTriggerStateRepo: CronTriggerStateRepository;
  toolCatalogRepo: ToolCatalogRepository;
  namespaceRepo: FirestoreNamespaceRepository;
  userProfileRepo: FirestoreUserProfileRepository;
  oauthProviderRepo: FirestoreOAuthProviderRepository;
  agentOAuthTokenRepo: FirestoreAgentOAuthTokenRepository;
  modelRegistryRepo: FirestoreModelRegistryRepository;
  secretsRepo: FirestoreWorkflowSecretsRepository;
  namespaceSecretsRepo: FirestoreNamespaceSecretsRepository;
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

  const db = getAdminFirestore();

  const processRepo = new FirestoreProcessRepository(db);
  const instanceRepo = new FirestoreProcessInstanceRepository(db);
  // Indirect-namespace repos depend on instanceRepo for parent-run namespace
  // resolution inside the namespace-scoped read variants (ADR-0004 §"Storage-
  // layer filter, today").
  const auditRepo = new FirestoreAuditRepository(db, instanceRepo);
  const agentRunRepo = new FirestoreAgentRunRepository(db, instanceRepo);
  const humanTaskRepo = new FirestoreHumanTaskRepository(db, instanceRepo);
  const handoffRepo = new FirestoreHandoffRepository(db, instanceRepo);
  const agentDefinitionRepo = new FirestoreAgentDefinitionRepository(db);
  const coworkSessionRepo = new FirestoreCoworkSessionRepository(db, instanceRepo);
  const cronTriggerStateRepo = new FirestoreCronTriggerStateRepository(db);
  const toolCatalogRepo: ToolCatalogRepository =
    process.env.STORAGE_BACKEND === 'postgres'
      ? new PostgresToolCatalogRepository(getSharedPostgresClient().db)
      : new FirestoreToolCatalogRepository(db);
  const namespaceRepo = new FirestoreNamespaceRepository(db);
  const userProfileRepo = new FirestoreUserProfileRepository(db);
  const oauthProviderRepo = new FirestoreOAuthProviderRepository(db);
  const agentOAuthTokenRepo = new FirestoreAgentOAuthTokenRepository(db);
  const modelRegistryRepo = new FirestoreModelRegistryRepository(db);
  const secretsRepo = new FirestoreWorkflowSecretsRepository(db);
  const namespaceSecretsRepo = new FirestoreNamespaceSecretsRepository(db);
  const eventLog = new FirestoreAgentEventLog(db);

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

  const adminAuth = getAdminAuth();
  const firebaseInvite = new FirebaseInviteService(adminAuth, db);
  const inviteService = new FirebaseInviteServiceAdapter(firebaseInvite, adminAuth, db);
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
    userProfileRepo,
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
    backfillInstanceNamespaces(db, processRepo).catch((err) => {
      console.error('[platform-services] Failed to backfill instance namespaces:', err);
    });
  }

  return services;
}
