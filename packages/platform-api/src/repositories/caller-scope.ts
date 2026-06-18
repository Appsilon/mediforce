import type { AgentRunner, PluginRegistry } from '@mediforce/agent-runtime';
import type {
  AuditRepository,
  CronTriggerStateRepository,
  EmailProviderInfo,
  ModelRegistryRepository,
  NamespaceRepository,
  PlatformSettingsRepository,
  UserDirectoryService,
  UserProfileRepository,
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
import type { AuthorizedAgentDefinitionRepository } from './authorized-agent-definition-repository';
import type { AuthorizedAgentEventRepository } from './authorized-agent-event-repository';
import type { AuthorizedAgentOAuthTokenRepository } from './authorized-agent-oauth-token-repository';
import type { AuthorizedAgentRunRepository } from './authorized-agent-run-repository';
import type { AuthorizedAuditEventRepository } from './authorized-audit-event-repository';
import type { AuthorizedCoworkSessionRepository } from './authorized-cowork-session-repository';
import type { AuthorizedHandoffRepository } from './authorized-handoff-repository';
import type { AuthorizedHumanTaskRepository } from './authorized-human-task-repository';
import type { AuthorizedOAuthProviderRepository } from './authorized-oauth-provider-repository';
import type { AuthorizedToolCatalogRepository } from './authorized-tool-catalog-repository';
import type { AuthorizedWorkflowDefinitionRepository } from './authorized-workflow-definition-repository';
import type { AuthorizedWorkflowRunRepository } from './authorized-workflow-run-repository';
import type { AuthorizedWorkflowSecretRepository } from './authorized-workflow-secret-repository';
import type { AuthorizedWorkspaceSecretRepository } from './authorized-workspace-secret-repository';

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
  readonly agentEvents: AuthorizedAgentEventRepository;
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
  readonly userProfiles: UserProfileRepository;
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
  /**
   * Raw audit-write surface — Phase 2 bridge per ADR-0005 §7. Handler-emitted
   * audit events use this; persistence-layer emission (post-headless-migration
   * audit-wiring phase) deletes this entry. Lives on `scope.system` rather
   * than the `AuthorizedAuditEventRepository` because `Authorized*Repository`
   * semantics promise per-method workspace gating, and `append` doesn't gate
   * (the writer is a handler that already passed the read-side gate).
   */
  readonly audit: AuditRepository;
  readonly runKicker: RunKicker;
  /**
   * Invite-flow surface (Firebase Auth user creation + password reset). `null`
   * when not wired; handlers throw `PreconditionFailedError` in that case so
   * tests can run without a Firebase Admin SDK.
   */
  readonly inviteService: InviteService | null;
  /**
   * Invite/workspace email surface. `null` when Mailgun env vars are unset —
   * handlers detect that and skip email delivery while still returning the
   * temporary password (matching today's behavior).
   */
  readonly inviteNotificationService: InviteNotificationService | null;
  /**
   * Docker image deletion port — local-`docker rmi` or container-worker proxy,
   * picked at wiring time. `null` for handlers tests that don't exercise the
   * delete-image flow; the handler throws `PreconditionFailedError` in that
   * case.
   */
  readonly dockerImages: DockerImagesService | null;
  /**
   * Directory lookup for Firebase Auth user metadata (email, lastSignInTime).
   * `null` when not configured — handlers that consume it (e.g.
   * `listNamespaceMembers`) degrade gracefully by returning null fields per
   * member rather than failing the whole response.
   */
  readonly userDirectory: UserDirectoryService | null;
  readonly platformSettings: PlatformSettingsRepository;
  readonly emailProviderInfo: EmailProviderInfo | null;
}
