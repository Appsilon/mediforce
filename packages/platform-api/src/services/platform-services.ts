import {
  FirestoreProcessRepository,
  FirestoreProcessInstanceRepository,
  FirestoreAuditRepository,
  FirestoreAgentRunRepository,
  FirestoreHumanTaskRepository,
  FirestoreAgentDefinitionRepository,
  FirestoreCoworkSessionRepository,
  FirestoreCronTriggerStateRepository,
  FirestoreToolCatalogRepository,
  FirestoreNamespaceRepository,
  FirestoreOAuthProviderRepository,
  FirestoreAgentOAuthTokenRepository,
  getAdminFirestore,
  validateSecretsKey,
} from '@mediforce/platform-infra';
import type { CronTriggerStateRepository } from '@mediforce/platform-core';
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
  processRepo: FirestoreProcessRepository;
  instanceRepo: FirestoreProcessInstanceRepository;
  auditRepo: FirestoreAuditRepository;
  humanTaskRepo: FirestoreHumanTaskRepository;
  agentDefinitionRepo: FirestoreAgentDefinitionRepository;
  coworkSessionRepo: FirestoreCoworkSessionRepository;
  cronTriggerStateRepo: CronTriggerStateRepository;
  toolCatalogRepo: FirestoreToolCatalogRepository;
  namespaceRepo: FirestoreNamespaceRepository;
  oauthProviderRepo: FirestoreOAuthProviderRepository;
  agentOAuthTokenRepo: FirestoreAgentOAuthTokenRepository;
}

export function getPlatformServices(): PlatformServices {
  if (services) return services;

  // Fail fast if the encryption key is missing or malformed — better to crash here
  // than to boot successfully and fail opaquely mid-workflow.
  validateSecretsKey();

  const db = getAdminFirestore();

  const processRepo = new FirestoreProcessRepository(db);
  const instanceRepo = new FirestoreProcessInstanceRepository(db);
  const auditRepo = new FirestoreAuditRepository(db);
  const agentRunRepo = new FirestoreAgentRunRepository(db);
  const humanTaskRepo = new FirestoreHumanTaskRepository(db);
  const agentDefinitionRepo = new FirestoreAgentDefinitionRepository(db);
  const coworkSessionRepo = new FirestoreCoworkSessionRepository(db);
  const cronTriggerStateRepo = new FirestoreCronTriggerStateRepository(db);
  const toolCatalogRepo = new FirestoreToolCatalogRepository(db);
  const namespaceRepo = new FirestoreNamespaceRepository(db);
  const oauthProviderRepo = new FirestoreOAuthProviderRepository(db);
  const agentOAuthTokenRepo = new FirestoreAgentOAuthTokenRepository(db);
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

  const engine = new WorkflowEngine(
    processRepo,
    instanceRepo,
    auditRepo,
    undefined,
    undefined,
    undefined,
    humanTaskRepo,
    coworkSessionRepo,
  );

  const agentRunner = new AgentRunner(
    instanceRepo,
    auditRepo,
    eventLog,
    agentRunRepo,
  );

  const actionRegistry = new ActionRegistry();
  actionRegistry.register('http', httpActionHandler);
  actionRegistry.register('reshape', reshapeActionHandler);

  const webhookRouter = new WebhookRouter(engine, processRepo);

  services = {
    engine,
    manualTrigger: new ManualTrigger(engine),
    cronTrigger: new CronTrigger(engine),
    webhookRouter,
    actionRegistry,
    agentRunner,
    pluginRegistry,
    llmClient,
    processRepo,
    instanceRepo,
    auditRepo,
    humanTaskRepo,
    agentDefinitionRepo,
    coworkSessionRepo,
    cronTriggerStateRepo,
    toolCatalogRepo,
    namespaceRepo,
    oauthProviderRepo,
    agentOAuthTokenRepo,
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
