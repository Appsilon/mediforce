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
  NamespaceRepository,
  NamespaceSecretsRepository,
  OAuthProviderRepository,
  ProcessInstanceRepository,
  ProcessRepository,
  ToolCatalogRepository,
  UserDirectoryService,
  WorkflowSecretsRepository,
} from '@mediforce/platform-core';
import type {
  CronTrigger,
  ManualTrigger,
  WebhookRouter,
  WorkflowEngine,
} from '@mediforce/workflow-engine';
import type { CallerIdentity } from '../auth.js';
import type { RunKicker } from '../runtime/run-kicker.js';
import type { DockerImageDeleter } from '../services/docker-image-deleter.js';
import type { InviteNotificationService, InviteService } from '../services/invite-notification.js';
import type { CallerScope } from './caller-scope.js';
import { AuthorizedAgentDefinitionRepository } from './authorized-agent-definition-repository.js';
import { AuthorizedAgentOAuthTokenRepository } from './authorized-agent-oauth-token-repository.js';
import { AuthorizedAgentRunRepository } from './authorized-agent-run-repository.js';
import { AuthorizedAuditEventRepository } from './authorized-audit-event-repository.js';
import { AuthorizedCoworkSessionRepository } from './authorized-cowork-session-repository.js';
import { AuthorizedHandoffRepository } from './authorized-handoff-repository.js';
import { AuthorizedHumanTaskRepository } from './authorized-human-task-repository.js';
import { AuthorizedOAuthProviderRepository } from './authorized-oauth-provider-repository.js';
import { AuthorizedToolCatalogRepository } from './authorized-tool-catalog-repository.js';
import { AuthorizedWorkflowDefinitionRepository } from './authorized-workflow-definition-repository.js';
import { AuthorizedWorkflowRunRepository } from './authorized-workflow-run-repository.js';
import { AuthorizedWorkflowSecretRepository } from './authorized-workflow-secret-repository.js';
import { AuthorizedWorkspaceSecretRepository } from './authorized-workspace-secret-repository.js';

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
  readonly namespaceRepo: NamespaceRepository;
  readonly oauthProviderRepo: OAuthProviderRepository;
  readonly agentOAuthTokenRepo: AgentOAuthTokenRepository;
  readonly modelRegistryRepo: ModelRegistryRepository;
  readonly secretsRepo: WorkflowSecretsRepository;
  readonly namespaceSecretsRepo: NamespaceSecretsRepository;
  readonly pluginRegistry: PluginRegistry;
  readonly engine: WorkflowEngine;
  readonly manualTrigger: ManualTrigger;
  readonly cronTrigger: CronTrigger;
  readonly webhookRouter: WebhookRouter;
  readonly agentRunner: AgentRunner;
  readonly runKicker: RunKicker;
  readonly inviteService: InviteService | null;
  readonly inviteNotificationService: InviteNotificationService | null;
  readonly dockerImageDeleter: DockerImageDeleter | null;
  readonly userDirectory: UserDirectoryService | null;
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

    tasks: new AuthorizedHumanTaskRepository(caller, services.humanTaskRepo),
    runs: new AuthorizedWorkflowRunRepository(caller, services.instanceRepo),
    workflowDefinitions: new AuthorizedWorkflowDefinitionRepository(
      caller,
      services.processRepo,
    ),
    agentDefinitions: new AuthorizedAgentDefinitionRepository(
      caller,
      services.agentDefinitionRepo,
    ),
    coworkSessions: new AuthorizedCoworkSessionRepository(
      caller,
      services.coworkSessionRepo,
    ),
    agentRuns: new AuthorizedAgentRunRepository(caller, services.agentRunRepo),
    auditEvents: new AuthorizedAuditEventRepository(caller, services.auditRepo),
    handoffs: new AuthorizedHandoffRepository(caller, services.handoffRepo),
    toolCatalog: new AuthorizedToolCatalogRepository(caller, services.toolCatalogRepo),
    oauthProviders: new AuthorizedOAuthProviderRepository(
      caller,
      services.oauthProviderRepo,
    ),
    agentOAuthTokens: new AuthorizedAgentOAuthTokenRepository(
      caller,
      services.agentOAuthTokenRepo,
    ),
    workspaceSecrets: new AuthorizedWorkspaceSecretRepository(
      caller,
      services.namespaceSecretsRepo,
      services.secretsRepo,
    ),
    workflowSecrets: new AuthorizedWorkflowSecretRepository(caller, services.secretsRepo),

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
      audit: services.auditRepo,
      runKicker: services.runKicker,
      inviteService: services.inviteService,
      inviteNotificationService: services.inviteNotificationService,
      dockerImageDeleter: services.dockerImageDeleter,
      userDirectory: services.userDirectory,
    },
  };
}
