import {
  PostgresAgentEventRepository,
  PostgresUserProfileRepository,
  PostgresCredentialsRepository,
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
  PostgresInviteService,
  validateSecretsKey,
  resolveEmailSenderFromEnv,
  EmailNotificationService,
  PostgresUserDirectoryService,
  mintVerificationToken,
} from '@mediforce/platform-infra';
import type { Database } from '@mediforce/platform-infra';
import type {
  AgentDefinitionRepository,
  AgentEventRepository,
  AgentOAuthTokenRepository,
  AgentRunRepository,
  AuditRepository,
  BlobStore,
  CoworkSessionRepository,
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
  CredentialsRepository,
  WorkflowSecretsRepository,
} from '@mediforce/platform-core';
import {
  ContainerWorkerDockerImagesService,
  LocalDockerImagesService,
  isLocalAgentMode,
  type DockerImagesService,
} from './docker-images-service';
import { isPasswordAuthEnabled } from '@mediforce/platform-core';
import { sendWorkspaceNotificationEmail, sendInviteSetupEmail } from './invite-emails';
import { normalizeBaseUrl, resolveInviteAppUrl } from '../contract/config';
import type {
  InviteNotificationService,
  InviteService,
  SendActivationEmailInput,
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
  triggerRepo: TriggerRepository;
  toolCatalogRepo: ToolCatalogRepository;
  namespaceRepo: NamespaceRepository;
  userProfileRepo: UserProfileRepository;
  credentialsRepo: CredentialsRepository;
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
   * User metadata lookup (uid → email, lastSignInTime) against `auth_users`.
   * Always wired in production (depends on Postgres, not Mailgun). Handlers
   * consume via `scope.system.userDirectory`.
   */
  userDirectory: UserDirectoryService;
  /** `isPasswordAuthEnabled(ENABLE_PASSWORD_AUTH)`, resolved once at wiring
   *  time so handlers never read `process.env`. */
  passwordAuthEnabled: boolean;
}

/** Invite-activation links live for 7 days — long enough for a colleague to
 *  act, independent of the Email provider's short login maxAge. */
const ACTIVATION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Adapts a `SendEmailFn` into the `InviteNotificationService`
 * interface — delegates to the existing pure email-body helpers and supplies
 * deployment config (app URL, sender name) so handlers never see env vars.
 *
 * `db` + `authSecret` are only touched by `sendActivationEmail`, which mints an
 * Auth.js-compatible verification token so the existing
 * `/api/auth/callback/email` handler accepts the activation link. An empty
 * `authSecret` is fine at construction — it only matters when an activation
 * email is actually sent.
 */
class EmailInviteNotificationService implements InviteNotificationService {
  constructor(
    private readonly sendEmail: SendEmailFn,
    private readonly appUrl: string,
    private readonly senderName: string,
    private readonly db: Database,
    private readonly authSecret: string,
  ) {}

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

  async sendActivationEmail(input: SendActivationEmailInput): Promise<void> {
    const appUrl = normalizeBaseUrl(input.baseUrl) ?? this.appUrl;
    const email = input.toEmail.toLowerCase();
    const raw = await mintVerificationToken(
      this.db,
      email,
      new Date(Date.now() + ACTIVATION_TOKEN_TTL_MS),
      this.authSecret,
    );
    const passwordSetupEnabled = input.passwordSetupEnabled !== false;
    // With password auth off there is no create-password step to land on — and
    // `/change-password` posts to a `password-login` route that 404s — so the
    // link drops the invitee straight into workspace selection instead.
    const callbackUrl = passwordSetupEnabled ? '/change-password' : '/workspace-selection';
    const activationUrl = `${appUrl}/api/auth/callback/email?callbackUrl=${encodeURIComponent(
      callbackUrl,
    )}&token=${raw}&email=${encodeURIComponent(email)}`;
    await sendInviteSetupEmail(
      {
        toEmail: input.toEmail,
        ...(input.inviterName !== undefined ? { inviterName: input.inviterName } : {}),
        ...(input.workspaceName !== undefined ? { workspaceName: input.workspaceName } : {}),
        activationUrl,
        appUrl,
        senderName: this.senderName,
        passwordSetupEnabled,
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
  const triggerRepo: TriggerRepository = new PostgresTriggerRepository(pg);
  const toolCatalogRepo: ToolCatalogRepository = new PostgresToolCatalogRepository(pg);
  const namespaceRepo: NamespaceRepository = new PostgresNamespaceRepository(pg);
  const userProfileRepo: UserProfileRepository = new PostgresUserProfileRepository(pg);
  const credentialsRepo: CredentialsRepository = new PostgresCredentialsRepository(pg);
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

  // Resolve the email provider once (shared with the NextAuth magic-link
  // provider). `null` means email is disabled; a misconfiguration throws.
  const resolvedEmail = resolveEmailSenderFromEnv();
  if (resolvedEmail === null) {
    console.log('[platform-services] MEDIFORCE_DISABLE_EMAIL=true — email handler and notifications disabled');
  } else {
    console.log(`[platform-services] Email provider: ${resolvedEmail.provider === 'mailgun' ? 'Mailgun' : 'SMTP'}`);
  }

  const emailSender: SendEmailFn | undefined = resolvedEmail?.send;
  const emailProviderInfo: EmailProviderInfo | null = resolvedEmail
    ? { provider: resolvedEmail.provider, configured: true, from: resolvedEmail.from }
    : null;

  const notificationService = emailSender
    ? new EmailNotificationService(emailSender)
    : undefined;
  // ADR-0002: reads the global `user_roles` + `auth_users` from Postgres
  // (off Firebase Auth) behind the same port. `getUsersByRole` targeting
  // depends on the one-time `seed-user-roles` having populated `user_roles`.
  // `lastSignInTime` comes from `auth_users.last_sign_in_at`, stamped by
  // `recordSignIn` on every successful sign-in.
  const userDirectoryService: UserDirectoryService = new PostgresUserDirectoryService(pg);

  const passwordAuthEnabled = isPasswordAuthEnabled(process.env.ENABLE_PASSWORD_AUTH);

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

  const manualTrigger = new ManualTrigger(engine, processRepo, triggerRepo);

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

  const webhookRouter = new WebhookRouter(engine, processRepo, triggerRepo);

  // Seed-based invite (PLAN-0002 §3.1): pre-seeds `auth_users` + workspace
  // membership + global roles in Postgres. No temp password, no credentials
  // email — the invitee signs in later via Google (verified-email auto-link)
  // or by setting a password. `PostgresInviteService` structurally implements
  // the framework-free `InviteService` port handlers consume.
  const inviteService: InviteService = new PostgresInviteService(pg);
  // Construction-time fallback app URL for invite/activation emails — used when
  // a send supplies no per-deployment `platform.baseUrl`. Resolves from the
  // canonical `APP_BASE_URL`/`NEXT_PUBLIC_APP_URL` vars (normalized), only
  // falling back to localhost in dev. See `resolveInviteAppUrl`.
  const inviteAppUrl = resolveInviteAppUrl();
  const senderName = resolvedEmail?.senderName ?? 'Mediforce';
  const inviteNotificationService = emailSender
    ? new EmailInviteNotificationService(
        emailSender,
        inviteAppUrl,
        senderName,
        getSharedPostgresClient().db,
        process.env.AUTH_SECRET ?? '',
      )
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
    triggerRepo,
    toolCatalogRepo,
    namespaceRepo,
    userProfileRepo,
    credentialsRepo,
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
    passwordAuthEnabled,
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
