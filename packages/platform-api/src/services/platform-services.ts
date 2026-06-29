import {
  PostgresAgentEventRepository,
  PostgresUserProfileRepository,
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
  PostgresTriggerRepository,
  PostgresAgentRunRepository,
  PostgresHumanTaskRepository,
  PostgresTaskAttachmentRepository,
  FilesystemBlobStore,
  PostgresCoworkSessionRepository,
  PostgresProcessInstanceRepository,
  PostgresProcessRepository,
  PostgresAgentEventLog,
  PostgresPlatformSettingsRepository,
  getSharedPostgresClient,
  FirebaseInviteService,
  validateSecretsKey,
  createMailgunSender,
  createSmtpSender,
  EmailNotificationService,
  PostgresUserDirectoryService,
  getAdminAuth,
} from '@mediforce/platform-infra';
import type {
  AgentDefinitionRepository,
  AgentEventRepository,
  AgentOAuthTokenRepository,
  AgentRunRepository,
  AuditRepository,
  BlobStore,
  CoworkSessionRepository,
  CronTriggerStateRepository,
  TriggerRepository,
  EmailProviderInfo,
  HandoffRepository,
  HumanTaskRepository,
  TaskAttachmentRepository,
  ModelRegistryRepository,
  NamespaceRepository,
  NamespaceSecretsRepository,
  OAuthProviderRepository,
  PlatformSettingsRepository,
  ProcessInstanceRepository,
  ProcessRepository,
  SendEmailFn,
  ToolCatalogRepository,
  UserDirectoryService,
  UserProfileRepository,
  WorkflowSecretsRepository,
} from '@mediforce/platform-core';
import {
  ContainerWorkerDockerImagesService,
  LocalDockerImagesService,
  isLocalAgentMode,
  type DockerImagesService,
} from './docker-images-service';
import { sendInviteEmail, sendWorkspaceNotificationEmail } from './invite-emails';
import { normalizeBaseUrl } from '../contract/config';
import type {
  InviteNotificationService,
  InviteService,
  InvitedUser,
  SendInviteEmailInput,
  SendWorkspaceNotificationEmailInput,
} from './invite-notification';
import {
  WorkflowEngine,
  ManualTrigger,
  CronTrigger,
} from '@mediforce/workflow-engine';
import {
  AgentRunner,
  PluginRunner,
  PluginRegistry,
  OpenRouterLlmClient,
  ClaudeCodeAgentPlugin,
  MockClaudeCodeAgentPlugin,
  OpenCodeAgentPlugin,
  ScriptContainerPlugin,
  DatabricksJobPlugin,
  ScriptStepExecutor,
  AgentStepExecutor,
} from '@mediforce/agent-runtime';
import {
  ActionRegistry,
  httpActionHandler,
  reshapeActionHandler,
  createSpawnActionHandler,
  createEmailActionHandler,
  waitActionHandler,
} from '@mediforce/core-actions';
import { createHttpSelfFetchRunKicker } from '../runtime/run-kicker';
import { WebhookRouter } from '@mediforce/workflow-engine';
import { seedBuiltinAgentDefinitions } from './seed-agent-definitions';
import { seedBuiltinToolCatalog } from './seed-tool-catalog';
import { eagerSyncIfStale } from '@mediforce/platform-infra';

let services: PlatformServices | null = null;
let seedingStarted = false;

export interface PlatformServices {
  engine: WorkflowEngine;
  manualTrigger: ManualTrigger;
  cronTrigger: CronTrigger;
  webhookRouter: WebhookRouter;
  actionRegistry: ActionRegistry;
  agentRunner: AgentRunner;
  scriptStepExecutor: ScriptStepExecutor;
  agentStepExecutor: AgentStepExecutor;
  pluginRegistry: PluginRegistry;
  llmClient: OpenRouterLlmClient;
  processRepo: ProcessRepository;
  instanceRepo: ProcessInstanceRepository;
  auditRepo: AuditRepository;
  agentEventRepo: AgentEventRepository;
  agentRunRepo: AgentRunRepository;
  humanTaskRepo: HumanTaskRepository;
  taskAttachmentRepo: TaskAttachmentRepository;
  blobStore: BlobStore;
  handoffRepo: HandoffRepository;
  agentDefinitionRepo: AgentDefinitionRepository;
  coworkSessionRepo: CoworkSessionRepository;
  cronTriggerStateRepo: CronTriggerStateRepository;
  triggerRepo: TriggerRepository;
  toolCatalogRepo: ToolCatalogRepository;
  namespaceRepo: NamespaceRepository;
  userProfileRepo: UserProfileRepository;
  oauthProviderRepo: OAuthProviderRepository;
  agentOAuthTokenRepo: AgentOAuthTokenRepository;
  modelRegistryRepo: ModelRegistryRepository;
  platformSettingsRepo: PlatformSettingsRepository;
  secretsRepo: WorkflowSecretsRepository;
  namespaceSecretsRepo: NamespaceSecretsRepository;
  inviteService: InviteService;
  /** `null` when email env vars are unset (email disabled). */
  inviteNotificationService: InviteNotificationService | null;
  emailProviderInfo: EmailProviderInfo | null;
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
    private readonly userProfileRepo: UserProfileRepository,
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
    const mustChangePassword = (await this.userProfileRepo.getProfile(uid))?.mustChangePassword ?? false;
    const hasNeverSignedIn = lastSignInTime === null || lastSignInTime === '';
    return mustChangePassword || hasNeverSignedIn;
  }
}

/**
 * Adapts a `SendEmailFn` into the `InviteNotificationService`
 * interface — delegates to the existing pure email-body helpers and supplies
 * deployment config (app URL, sender name) so handlers never see env vars.
 */
class EmailInviteNotificationService implements InviteNotificationService {
  constructor(
    private readonly sendEmail: SendEmailFn,
    private readonly appUrl: string,
    private readonly senderName: string,
  ) {}

  async sendInviteEmail(input: SendInviteEmailInput): Promise<void> {
    const appUrl = normalizeBaseUrl(input.baseUrl) ?? this.appUrl;
    await sendInviteEmail(
      {
        toEmail: input.toEmail,
        temporaryPassword: input.temporaryPassword,
        appUrl,
        senderName: this.senderName,
      },
      this.sendEmail,
    );
  }

  async sendWorkspaceNotificationEmail(input: SendWorkspaceNotificationEmailInput): Promise<void> {
    const appUrl = normalizeBaseUrl(input.baseUrl) ?? this.appUrl;
    await sendWorkspaceNotificationEmail(
      {
        toEmail: input.toEmail,
        inviterName: input.inviterName,
        workspaceName: input.workspaceName,
        workspaceUrl: `${appUrl}/${input.workspaceHandle}`,
        appUrl,
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
  const agentEventRepo: AgentEventRepository = new PostgresAgentEventRepository(instanceRepo);
  const agentRunRepo: AgentRunRepository = new PostgresAgentRunRepository(pg, instanceRepo);
  const humanTaskRepo: HumanTaskRepository = new PostgresHumanTaskRepository(pg, instanceRepo);
  const taskAttachmentRepo: TaskAttachmentRepository = new PostgresTaskAttachmentRepository(pg);
  const blobStore: BlobStore = new FilesystemBlobStore();
  const handoffRepo: HandoffRepository = new PostgresHandoffRepository(pg, instanceRepo);
  const agentDefinitionRepo: AgentDefinitionRepository = new PostgresAgentDefinitionRepository(pg);
  const coworkSessionRepo: CoworkSessionRepository =
    new PostgresCoworkSessionRepository(pg, instanceRepo);
  const cronTriggerStateRepo: CronTriggerStateRepository =
    new PostgresCronTriggerStateRepository(pg);
  const triggerRepo: TriggerRepository = new PostgresTriggerRepository(pg);
  const toolCatalogRepo: ToolCatalogRepository = new PostgresToolCatalogRepository(pg);
  const namespaceRepo: NamespaceRepository = new PostgresNamespaceRepository(pg);
  const userProfileRepo: UserProfileRepository = new PostgresUserProfileRepository(pg);
  const oauthProviderRepo: OAuthProviderRepository = new PostgresOAuthProviderRepository(pg);
  const agentOAuthTokenRepo: AgentOAuthTokenRepository =
    new PostgresAgentOAuthTokenRepository(pg);
  const modelRegistryRepo: ModelRegistryRepository = new PostgresModelRegistryRepository(pg);
  const platformSettingsRepo: PlatformSettingsRepository = new PostgresPlatformSettingsRepository(pg);
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
  pluginRegistry.register('databricks-job', new DatabricksJobPlugin());

  const otelTracingOptions = {
    captureContent: process.env.MEDIFORCE_OTEL_CAPTURE_CONTENT === 'true',
  };

  const llmClient = new OpenRouterLlmClient(
    process.env.OPENROUTER_API_KEY ?? '',
    'anthropic/claude-sonnet-4',
    otelTracingOptions,
  );

  const emailDisabled = process.env.MEDIFORCE_DISABLE_EMAIL === 'true';
  const mailgunApiKey = process.env.MAILGUN_API_KEY ?? '';
  const mailgunDomain = process.env.MAILGUN_DOMAIN ?? '';
  const mailgunFrom = process.env.MAILGUN_FROM_EMAIL ?? '';
  const mailgunSenderName = process.env.MAILGUN_SENDER_NAME ?? 'Mediforce';
  const mailgunConfigured = mailgunApiKey !== '' && mailgunDomain !== '' && mailgunFrom !== '';

  const smtpHost = process.env.SMTP_HOST ?? '';
  const smtpPort = process.env.SMTP_PORT ?? '';
  const smtpUser = process.env.SMTP_USER ?? '';
  const smtpPass = process.env.SMTP_PASS ?? '';
  const smtpSecure = process.env.SMTP_SECURE !== 'false';
  const smtpFrom = process.env.SMTP_FROM_EMAIL ?? '';
  const smtpSenderName = process.env.SMTP_SENDER_NAME ?? 'Mediforce';
  const smtpConfigured = smtpHost !== '' && smtpFrom !== '';

  const rawEmailProvider = process.env.EMAIL_PROVIDER || undefined;
  if (rawEmailProvider !== undefined && rawEmailProvider !== 'mailgun' && rawEmailProvider !== 'smtp') {
    throw new Error(
      `EMAIL_PROVIDER="${rawEmailProvider}" is not valid. Use "mailgun" or "smtp".`,
    );
  }
  const explicitProvider = rawEmailProvider as 'mailgun' | 'smtp' | undefined;
  const resolvedProvider = resolveEmailProvider(explicitProvider, mailgunConfigured, smtpConfigured);

  if (emailDisabled) {
    console.log('[platform-services] MEDIFORCE_DISABLE_EMAIL=true — email handler and notifications disabled');
  }

  let emailSender: SendEmailFn | undefined;
  let emailProviderInfo: EmailProviderInfo | null = null;

  if (!emailDisabled && resolvedProvider === 'mailgun') {
    if (!mailgunConfigured) {
      const missing = [
        !mailgunApiKey && 'MAILGUN_API_KEY',
        !mailgunDomain && 'MAILGUN_DOMAIN',
        !mailgunFrom && 'MAILGUN_FROM_EMAIL',
      ].filter(Boolean).join(', ');
      throw new Error(
        `EMAIL_PROVIDER=mailgun but config incomplete (missing: ${missing}). ` +
        `Set the env vars or set MEDIFORCE_DISABLE_EMAIL=true to start without email.`,
      );
    }
    emailSender = createMailgunSender({
      apiKey: mailgunApiKey,
      domain: mailgunDomain,
      defaultFrom: mailgunFrom,
      defaultSenderName: mailgunSenderName,
    });
    emailProviderInfo = { provider: 'mailgun', configured: true, from: mailgunFrom };
    console.log('[platform-services] Email provider: Mailgun');
  } else if (!emailDisabled && resolvedProvider === 'smtp') {
    if (!smtpConfigured) {
      const missing = [
        !smtpHost && 'SMTP_HOST',
        !smtpFrom && 'SMTP_FROM_EMAIL',
      ].filter(Boolean).join(', ');
      throw new Error(
        `EMAIL_PROVIDER=smtp but config incomplete (missing: ${missing}). ` +
        `Set the env vars or set MEDIFORCE_DISABLE_EMAIL=true to start without email.`,
      );
    }
    emailSender = createSmtpSender({
      host: smtpHost,
      port: smtpPort !== '' ? Number(smtpPort) : 587,
      secure: smtpSecure,
      user: smtpUser,
      pass: smtpPass,
      defaultFrom: smtpFrom,
      defaultSenderName: smtpSenderName,
    });
    emailProviderInfo = { provider: 'smtp', configured: true, from: smtpFrom };
    console.log('[platform-services] Email provider: SMTP');
  } else if (!emailDisabled && resolvedProvider === null) {
    throw new Error(
      'Email is enabled but no email provider is configured. ' +
      'Set MAILGUN_* or SMTP_* env vars, or set MEDIFORCE_DISABLE_EMAIL=true to start without email.',
    );
  }

  const notificationService = emailSender
    ? new EmailNotificationService(emailSender)
    : undefined;
  // ADR-0002 PR1: reads the global `user_roles` + `auth_users` from Postgres
  // (off Firebase Auth) behind the same port. `getUsersByRole` targeting
  // depends on the one-time `seed-user-roles` having populated `user_roles`.
  // `lastSignInTime` is null until NextAuth sessions land (PR2).
  const userDirectoryService: UserDirectoryService = new PostgresUserDirectoryService(pg);

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

  const pluginRunner = new PluginRunner(eventLog);

  const agentRunner = new AgentRunner(
    instanceRepo,
    auditRepo,
    eventLog,
    agentRunRepo,
    otelTracingOptions,
  );

  const scriptStepExecutor = new ScriptStepExecutor(pluginRunner);
  const agentStepExecutor = new AgentStepExecutor(agentRunner);

  const manualTrigger = new ManualTrigger(engine, processRepo);

  const actionRegistry = new ActionRegistry();
  actionRegistry.register('http', httpActionHandler);
  actionRegistry.register('reshape', reshapeActionHandler);
  const spawnRunKicker = createHttpSelfFetchRunKicker({
    baseUrl: () => process.env.APP_BASE_URL ?? 'http://localhost:9003',
    apiKey: () => process.env.PLATFORM_API_KEY ?? '',
  });
  actionRegistry.register('spawn', createSpawnActionHandler(manualTrigger, processRepo, spawnRunKicker));
  actionRegistry.register('wait', waitActionHandler);
  if (emailSender) {
    actionRegistry.register('email', createEmailActionHandler(emailSender));
  }

  const webhookRouter = new WebhookRouter(engine, processRepo);

  // FirebaseInviteService writes to the Firebase Auth user store (identity
  // stays on Firebase Auth) and records the must-change-password flag via the
  // Postgres user-profile repository.
  const adminAuth = getAdminAuth();
  const firebaseInvite = new FirebaseInviteService(adminAuth, userProfileRepo);
  const inviteService = new FirebaseInviteServiceAdapter(firebaseInvite, adminAuth, userProfileRepo);
  // `appUrl` matches the legacy invite route's fallback so dev-without-
  // NEXT_PUBLIC_PLATFORM_URL still renders sensible links.
  const inviteAppUrl =
    process.env.NEXT_PUBLIC_PLATFORM_URL ?? `http://localhost:${process.env.PORT ?? '3000'}`;
  const senderName = resolvedProvider === 'mailgun' ? mailgunSenderName : smtpSenderName;
  const inviteNotificationService = emailSender
    ? new EmailInviteNotificationService(emailSender, inviteAppUrl, senderName)
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
    scriptStepExecutor,
    agentStepExecutor,
    pluginRegistry,
    llmClient,
    processRepo,
    instanceRepo,
    auditRepo,
    agentEventRepo,
    agentRunRepo,
    humanTaskRepo,
    taskAttachmentRepo,
    blobStore,
    handoffRepo,
    agentDefinitionRepo,
    coworkSessionRepo,
    cronTriggerStateRepo,
    triggerRepo,
    toolCatalogRepo,
    namespaceRepo,
    userProfileRepo,
    oauthProviderRepo,
    agentOAuthTokenRepo,
    modelRegistryRepo,
    platformSettingsRepo,
    secretsRepo,
    namespaceSecretsRepo,
    inviteService,
    inviteNotificationService,
    emailProviderInfo,
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
    eagerSyncIfStale(modelRegistryRepo, { auditRepo }).catch((err) => {
      console.error('[platform-services] Model registry eager sync failed:', err);
    });
  }

  return services;
}

function resolveEmailProvider(
  explicit: 'mailgun' | 'smtp' | undefined,
  mailgunConfigured: boolean,
  smtpConfigured: boolean,
): 'mailgun' | 'smtp' | null {
  if (explicit !== undefined) return explicit;
  if (mailgunConfigured && smtpConfigured) {
    throw new Error(
      'Both Mailgun and SMTP env vars are set. Set EMAIL_PROVIDER=mailgun or EMAIL_PROVIDER=smtp to disambiguate.',
    );
  }
  if (mailgunConfigured) return 'mailgun';
  if (smtpConfigured) return 'smtp';
  return null;
}
