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
  ToolCatalogRepository,
  WorkflowSecretsRepository,
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
  const userDirectoryService = notificationService
    ? new FirebaseUserDirectoryService(getAdminAuth())
    : undefined;

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
  if (mailgunSender) {
    actionRegistry.register('email', createEmailActionHandler(mailgunSender));
  }

  const webhookRouter = new WebhookRouter(engine, processRepo);

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
