import type { AgentRunner, PluginRegistry } from '@mediforce/agent-runtime';
import type {
  AgentDefinitionRepository,
  AgentEventRepository,
  AgentOAuthTokenRepository,
  AgentRunRepository,
  AuditRepository,
  BlobStore,
  CoworkSessionRepository,
  CronTriggerStateRepository,
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
  ToolCatalogRepository,
  UserDirectoryService,
  UserProfileRepository,
  WorkflowSecretsRepository,
} from '@mediforce/platform-core';
import type {
  CronTrigger,
  ManualTrigger,
  WebhookRouter,
  WorkflowEngine,
} from '@mediforce/workflow-engine';
import type { CallerIdentity } from '../auth';
import type { RunKicker } from '../runtime/run-kicker';
import type { DockerImagesService } from '../services/docker-images-service';
import type { InviteNotificationService, InviteService } from '../services/invite-notification';
import type { CallerScope } from './caller-scope';
import { AuthorizedAgentDefinitionRepository } from './authorized-agent-definition-repository';
import { AuthorizedAgentEventRepository } from './authorized-agent-event-repository';
import { AuthorizedAgentOAuthTokenRepository } from './authorized-agent-oauth-token-repository';
import { AuthorizedAgentRunRepository } from './authorized-agent-run-repository';
import { AuthorizedAuditEventRepository } from './authorized-audit-event-repository';
import { AuthorizedCoworkSessionRepository } from './authorized-cowork-session-repository';
import { AuthorizedCronTriggerStateRepository } from './authorized-cron-trigger-state-repository';
import { AuthorizedHandoffRepository } from './authorized-handoff-repository';
import { AuthorizedHumanTaskRepository } from './authorized-human-task-repository';
import { AuthorizedOAuthProviderRepository } from './authorized-oauth-provider-repository';
import { AuthorizedTaskAttachmentRepository } from './authorized-task-attachment-repository';
import { AuthorizedToolCatalogRepository } from './authorized-tool-catalog-repository';
import { AuthorizedWorkflowDefinitionRepository } from './authorized-workflow-definition-repository';
import { AuthorizedWorkflowRunRepository } from './authorized-workflow-run-repository';
import { AuthorizedWorkflowSecretRepository } from './authorized-workflow-secret-repository';
import { AuthorizedWorkspaceSecretRepository } from './authorized-workspace-secret-repository';

/**
 * Subset of `PlatformServices` (interface-typed) that `createCallerScope`
 * depends on. Tests build this from in-memory repos; production wires it
 * to the concrete services from `getPlatformServices()`.
 */
export interface CallerScopeServices {
  readonly instanceRepo: ProcessInstanceRepository;
  readonly processRepo: ProcessRepository;
  readonly auditRepo: AuditRepository;
  readonly agentEventRepo: AgentEventRepository;
  readonly agentRunRepo: AgentRunRepository;
  readonly humanTaskRepo: HumanTaskRepository;
  readonly taskAttachmentRepo: TaskAttachmentRepository;
  readonly blobStore: BlobStore;
  readonly handoffRepo: HandoffRepository;
  readonly agentDefinitionRepo: AgentDefinitionRepository;
  readonly coworkSessionRepo: CoworkSessionRepository;
  readonly cronTriggerStateRepo: CronTriggerStateRepository;
  readonly toolCatalogRepo: ToolCatalogRepository;
  readonly namespaceRepo: NamespaceRepository;
  readonly userProfileRepo: UserProfileRepository;
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
  readonly dockerImages: DockerImagesService | null;
  readonly userDirectory: UserDirectoryService | null;
  readonly platformSettingsRepo: PlatformSettingsRepository;
  readonly emailProviderInfo: EmailProviderInfo | null;
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
    attachments: new AuthorizedTaskAttachmentRepository(caller, services.taskAttachmentRepo),
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
    agentEvents: new AuthorizedAgentEventRepository(caller, services.agentEventRepo),
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
    userProfiles: services.userProfileRepo,
    cron: new AuthorizedCronTriggerStateRepository(caller, services.cronTriggerStateRepo),

    system: {
      engine: services.engine,
      manualTrigger: services.manualTrigger,
      cronTrigger: services.cronTrigger,
      cron: services.cronTriggerStateRepo,
      webhookRouter: services.webhookRouter,
      agentRunner: services.agentRunner,
      blobStore: services.blobStore,
      audit: services.auditRepo,
      runKicker: services.runKicker,
      inviteService: services.inviteService,
      inviteNotificationService: services.inviteNotificationService,
      dockerImages: services.dockerImages,
      userDirectory: services.userDirectory,
      platformSettings: services.platformSettingsRepo,
      emailProviderInfo: services.emailProviderInfo,
    },
  };
}
