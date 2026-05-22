import type { AgentRunner, PluginRegistry } from '@mediforce/agent-runtime';
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
  OAuthProviderRepository,
  ProcessInstanceRepository,
  ProcessRepository,
  ToolCatalogRepository,
} from '@mediforce/platform-core';
import type {
  CronTrigger,
  ManualTrigger,
  WebhookRouter,
  WorkflowEngine,
} from '@mediforce/workflow-engine';
import type { CallerIdentity } from '../auth.js';
import type { CallerScope, NamespaceLookupView } from './caller-scope.js';
import type { NamespaceSecretsRepositoryView } from './authorized-workspace-secret-repository.js';
import type { WorkflowSecretsRepositoryView } from './authorized-workflow-secret-repository.js';
import { AuthorizedAgentDefinitionRepositoryImpl } from './authorized-agent-definition-repository.js';
import { AuthorizedAgentOAuthTokenRepositoryImpl } from './authorized-agent-oauth-token-repository.js';
import { AuthorizedAgentRunRepositoryImpl } from './authorized-agent-run-repository.js';
import { AuthorizedAuditEventRepositoryImpl } from './authorized-audit-event-repository.js';
import { AuthorizedCoworkSessionRepositoryImpl } from './authorized-cowork-session-repository.js';
import { AuthorizedHandoffRepositoryImpl } from './authorized-handoff-repository.js';
import { AuthorizedHumanTaskRepositoryImpl } from './authorized-human-task-repository.js';
import { AuthorizedOAuthProviderRepositoryImpl } from './authorized-oauth-provider-repository.js';
import { AuthorizedToolCatalogRepositoryImpl } from './authorized-tool-catalog-repository.js';
import { AuthorizedWorkflowDefinitionRepositoryImpl } from './authorized-workflow-definition-repository.js';
import { AuthorizedWorkflowRunRepositoryImpl } from './authorized-workflow-run-repository.js';
import { AuthorizedWorkflowSecretRepositoryImpl } from './authorized-workflow-secret-repository.js';
import { AuthorizedWorkspaceSecretRepositoryImpl } from './authorized-workspace-secret-repository.js';

/**
 * Subset of `PlatformServices` (interface-typed) that `createCallerScope`
 * depends on. Tests build this from in-memory repos; production wires it
 * to the concrete services from `getPlatformServices()`.
 */
export interface CallerScopeServices {
  readonly instanceRepo: ProcessInstanceRepository;
  readonly processRepo: ProcessRepository;
  readonly auditRepo: AuditRepository;
  readonly agentRunRepo: AgentRunRepository;
  readonly humanTaskRepo: HumanTaskRepository;
  readonly handoffRepo: HandoffRepository;
  readonly agentDefinitionRepo: AgentDefinitionRepository;
  readonly coworkSessionRepo: CoworkSessionRepository;
  readonly cronTriggerStateRepo: CronTriggerStateRepository;
  readonly toolCatalogRepo: ToolCatalogRepository;
  readonly namespaceRepo: NamespaceLookupView;
  readonly oauthProviderRepo: OAuthProviderRepository;
  readonly agentOAuthTokenRepo: AgentOAuthTokenRepository;
  readonly modelRegistryRepo: ModelRegistryRepository;
  readonly secretsRepo: WorkflowSecretsRepositoryView;
  readonly namespaceSecretsRepo: NamespaceSecretsRepositoryView;
  readonly pluginRegistry: PluginRegistry;
  readonly engine: WorkflowEngine;
  readonly manualTrigger: ManualTrigger;
  readonly cronTrigger: CronTrigger;
  readonly webhookRouter: WebhookRouter;
  readonly agentRunner: AgentRunner;
}

/**
 * Build a per-request `CallerScope` from the platform's services + the
 * request's resolved caller identity. The route adapter calls this once per
 * request; the resulting scope is the only data-access surface handlers see.
 */
export function createCallerScope(
  services: CallerScopeServices,
  caller: CallerIdentity,
): CallerScope {
  return {
    caller,

    tasks: new AuthorizedHumanTaskRepositoryImpl(
      caller,
      services.humanTaskRepo,
      services.instanceRepo,
    ),
    runs: new AuthorizedWorkflowRunRepositoryImpl(caller, services.instanceRepo),
    workflowDefinitions: new AuthorizedWorkflowDefinitionRepositoryImpl(
      caller,
      services.processRepo,
    ),
    agentDefinitions: new AuthorizedAgentDefinitionRepositoryImpl(
      caller,
      services.agentDefinitionRepo,
    ),
    coworkSessions: new AuthorizedCoworkSessionRepositoryImpl(
      caller,
      services.coworkSessionRepo,
      services.instanceRepo,
    ),
    agentRuns: new AuthorizedAgentRunRepositoryImpl(
      caller,
      services.agentRunRepo,
      services.instanceRepo,
    ),
    auditEvents: new AuthorizedAuditEventRepositoryImpl(
      caller,
      services.auditRepo,
      services.instanceRepo,
    ),
    handoffs: new AuthorizedHandoffRepositoryImpl(
      caller,
      services.handoffRepo,
      services.instanceRepo,
    ),
    toolCatalog: new AuthorizedToolCatalogRepositoryImpl(caller, services.toolCatalogRepo),
    oauthProviders: new AuthorizedOAuthProviderRepositoryImpl(
      caller,
      services.oauthProviderRepo,
    ),
    agentOAuthTokens: new AuthorizedAgentOAuthTokenRepositoryImpl(
      caller,
      services.agentOAuthTokenRepo,
    ),
    workspaceSecrets: new AuthorizedWorkspaceSecretRepositoryImpl(
      caller,
      services.namespaceSecretsRepo,
    ),
    workflowSecrets: new AuthorizedWorkflowSecretRepositoryImpl(caller, services.secretsRepo),

    models: services.modelRegistryRepo,
    plugins: services.pluginRegistry,
    workspaces: services.namespaceRepo,
    cron: services.cronTriggerStateRepo,

    system: {
      engine: services.engine,
      manualTrigger: services.manualTrigger,
      cronTrigger: services.cronTrigger,
      webhookRouter: services.webhookRouter,
      agentRunner: services.agentRunner,
    },
  };
}
