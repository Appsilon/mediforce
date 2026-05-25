import type { AgentRunner, PluginRegistry } from '@mediforce/agent-runtime';
import type {
  CronTriggerStateRepository,
  ModelRegistryRepository,
  NamespaceRepository,
} from '@mediforce/platform-core';
import type {
  CronTrigger,
  ManualTrigger,
  WebhookRouter,
  WorkflowEngine,
} from '@mediforce/workflow-engine';
import type { CallerIdentity } from '../auth.js';
import type { AuthorizedAgentDefinitionRepository } from './authorized-agent-definition-repository.js';
import type { AuthorizedAgentOAuthTokenRepository } from './authorized-agent-oauth-token-repository.js';
import type { AuthorizedAgentRunRepository } from './authorized-agent-run-repository.js';
import type { AuthorizedAuditEventRepository } from './authorized-audit-event-repository.js';
import type { AuthorizedCoworkSessionRepository } from './authorized-cowork-session-repository.js';
import type { AuthorizedHandoffRepository } from './authorized-handoff-repository.js';
import type { AuthorizedHumanTaskRepository } from './authorized-human-task-repository.js';
import type { AuthorizedOAuthProviderRepository } from './authorized-oauth-provider-repository.js';
import type { AuthorizedToolCatalogRepository } from './authorized-tool-catalog-repository.js';
import type { AuthorizedWorkflowDefinitionRepository } from './authorized-workflow-definition-repository.js';
import type { AuthorizedWorkflowRunRepository } from './authorized-workflow-run-repository.js';
import type { AuthorizedWorkflowSecretRepository } from './authorized-workflow-secret-repository.js';
import type { AuthorizedWorkspaceSecretRepository } from './authorized-workspace-secret-repository.js';

/**
 * Per-request data-access surface for an API handler.
 *
 * Built once by the route adapter (`createCallerScope(services, caller)`),
 * threaded into every handler as the second positional argument. Handlers
 * never receive raw repositories — `CallerScope` is the only path. This is
 * how ADR-0004's "authorization in the data layer" promise becomes
 * compile-time enforced: a handler that wants to bypass the workspace gate
 * has to import from `@mediforce/platform-infra` directly, which fails the
 * `no-raw-repo-imports` static guard.
 *
 * `models`, `plugins`, and `workspaces` are deployment-global (no per-tenant
 * view), so they're pass-through reads of the raw repos.
 *
 * `caller` is exposed for handlers that need it (audit attribution,
 * personalisation, cron heartbeat's apiKey-only gate). The wrapper layer
 * absorbs every workspace-membership decision below it; reaching for
 * `caller` directly should be the exception.
 */
export interface CallerScope {
  readonly caller: CallerIdentity;

  // Workspace-scoped wrappers
  readonly tasks: AuthorizedHumanTaskRepository;
  readonly runs: AuthorizedWorkflowRunRepository;
  readonly workflowDefinitions: AuthorizedWorkflowDefinitionRepository;
  readonly agentDefinitions: AuthorizedAgentDefinitionRepository;
  readonly coworkSessions: AuthorizedCoworkSessionRepository;
  readonly agentRuns: AuthorizedAgentRunRepository;
  readonly auditEvents: AuthorizedAuditEventRepository;
  readonly handoffs: AuthorizedHandoffRepository;
  readonly toolCatalog: AuthorizedToolCatalogRepository;
  readonly oauthProviders: AuthorizedOAuthProviderRepository;
  readonly agentOAuthTokens: AuthorizedAgentOAuthTokenRepository;
  readonly workspaceSecrets: AuthorizedWorkspaceSecretRepository;
  readonly workflowSecrets: AuthorizedWorkflowSecretRepository;

  // Deployment-global pass-throughs
  readonly models: ModelRegistryRepository;
  readonly plugins: PluginsRegistryView;
  readonly workspaces: NamespaceRepository;
  readonly cron: CronTriggerStateRepository;

  // System services (engine, manual trigger, etc.) — handlers use these
  // when delegating to engine machinery (resume, advance, create-run).
  // Treated as god-mode-by-design; accountability via AuditEvent.
  readonly system: SystemServices;
}

/** Structural view of `agent-runtime`'s `PluginRegistry` (the same shape the
 *  pluginRegistry passes; declared structurally so handler tests don't have to
 *  spin up the real registry). */
export type PluginsRegistryView = Pick<PluginRegistry, 'list'>;

/**
 * System-actor handles exposed to handlers that genuinely need them. Use
 * sparingly: every reach into `scope.system` is a workspace-gate bypass and
 * MUST be paired with an explicit caller check (e.g. cron heartbeat's
 * `caller.isSystemActor` gate).
 */
export interface SystemServices {
  readonly engine: WorkflowEngine;
  readonly manualTrigger: ManualTrigger;
  readonly cronTrigger: CronTrigger;
  readonly webhookRouter: WebhookRouter;
  readonly agentRunner: AgentRunner;
}
