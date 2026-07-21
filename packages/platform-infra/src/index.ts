// Auth wiring. Firebase Auth is fully removed (ADR-0002 PR2); identity + the
// user directory + invites + sessions run on Postgres (NextAuth database
// sessions). The `seed-user-roles`/migration script still reads Firebase Auth
// via `firebase-admin` as a one-time export source (ADR-0002 §4, PLAN §8.2
// grep exception).
export { PostgresUserDirectoryService } from './auth/postgres-user-directory-service';
export { PostgresInviteService } from './auth/postgres-invite-service';
export type { SeedInviteInput, SeededInvite } from './auth/postgres-invite-service';
export { buildUserRolesSeed } from './auth/seed-user-roles';
export {
  resolveSessionUserId,
  getUserRoles,
  createDatabaseSession,
  SESSION_TTL_MS,
} from './auth/session-store';
export { setUserPasswordHash } from './auth/credentials-store';
export type {
  FirebaseUserExport,
  FirebaseCustomClaims,
  UserRolesSeed,
  AuthUserSeedRow,
  UserRoleSeedRow,
} from './auth/seed-user-roles';

// Notifications + email
export { EmailNotificationService } from './notifications/mailgun-notification-service';
export { WebhookNotificationService } from './notifications/webhook-notification-service';
export { createMailgunSender } from './email/mailgun-client';
export type { MailgunConfig } from './email/mailgun-client';
export { createSmtpSender } from './email/smtp-client';
export type { SmtpConfig } from './email/smtp-client';

// Postgres repositories — the only data backend (ADR-0001).
export { PostgresToolCatalogRepository } from './postgres/repositories/tool-catalog-repository';
export { PostgresNamespaceRepository } from './postgres/repositories/namespace-repository';
export { PostgresAuditRepository } from './postgres/repositories/audit-repository';
export { PostgresOAuthProviderRepository } from './postgres/repositories/oauth-provider-repository';
export { PostgresAgentOAuthTokenRepository } from './postgres/repositories/agent-oauth-token-repository';
export { PostgresCronTriggerStateRepository } from './postgres/repositories/cron-trigger-state-repository';
export { PostgresTriggerRepository } from './postgres/repositories/trigger-repository';
export { PostgresAgentRunRepository } from './postgres/repositories/agent-run-repository';
export { PostgresAgentEventRepository } from './postgres/repositories/agent-event-repository';
export { PostgresHumanTaskRepository } from './postgres/repositories/human-task-repository';
export { PostgresTaskAttachmentRepository } from './postgres/repositories/task-attachment-repository';
export { PostgresHandoffRepository } from './postgres/repositories/handoff-repository';
export { PostgresCoworkSessionRepository } from './postgres/repositories/cowork-session-repository';
export { PostgresProcessInstanceRepository } from './postgres/repositories/process-instance-repository';
export { PostgresProcessRepository } from './postgres/repositories/process-repository';
export { PostgresAgentDefinitionRepository } from './postgres/repositories/agent-definition-repository';
export { PostgresModelRegistryRepository } from './postgres/repositories/model-registry-repository';
export { PostgresNamespaceSecretsRepository } from './postgres/repositories/namespace-secrets-repository';
export { PostgresWorkflowSecretsRepository } from './postgres/repositories/workflow-secrets-repository';
export { PostgresUserProfileRepository } from './postgres/repositories/user-profile-repository';
export { PostgresPlatformSettingsRepository } from './postgres/repositories/platform-settings-repository';
export { createPostgresClient, getSharedPostgresClient } from './postgres/client';
export type { Database } from './postgres/client';
// NextAuth (@auth/drizzle-adapter) schema tables (ADR-0002 PR2). Exported so
// the platform-ui `auth.ts` can wire the DrizzleAdapter without reaching into
// the schema directory directly.
export { authUsers } from './postgres/schema/auth-user';
export { authAccounts } from './postgres/schema/auth-account';
export { authSessions } from './postgres/schema/auth-session';
export { authVerificationTokens } from './postgres/schema/auth-verification-token';
export { PostgresAgentEventLog } from './postgres/agent-event-log';

// Blob storage (ADR-0003 task attachments).
export { FilesystemBlobStore } from './storage/filesystem-blob-store';

// Crypto + sync
export { validateSecretsKey } from './crypto/secrets-cipher';
export { syncFromOpenRouter, syncWithRetry } from './sync/openrouter-sync';
export type { SyncResult } from './sync/openrouter-sync';
export { eagerSyncIfStale } from './sync/eager-sync';
export { isRegistryStale, MODEL_SYNC_CRON } from './sync/model-sync-scheduler';

// Sync alert webhook
export { sendSyncFailureWebhook, sendTestWebhook } from './notifications/sync-alert-webhook';
export type { SyncFailureContext, TestWebhookResult } from './notifications/sync-alert-webhook';
