// Auth / Firebase wiring (kept — Firebase Auth is the identity provider).
// Firestore is fully removed (ADR-0001 final cutover, #534); only Auth and
// Storage remain on Firebase.
export { FirebaseUserDirectoryService } from './auth/firebase-user-directory-service';
export { FirebaseInviteService } from './auth/firebase-invite-service';
export { getAdminAuth } from './auth/firebase-admin-init';
export {
  initializeFirebase,
  getFirebaseAuth,
} from './config/firebase-init';
export type { FirebaseConfig } from './config/firebase-init';

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
export { PostgresAgentRunRepository } from './postgres/repositories/agent-run-repository';
export { PostgresAgentEventRepository } from './postgres/repositories/agent-event-repository';
export { PostgresHumanTaskRepository } from './postgres/repositories/human-task-repository';
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
export { PostgresAgentEventLog } from './postgres/agent-event-log';

// Crypto + sync
export { validateSecretsKey } from './crypto/secrets-cipher';
export { syncFromOpenRouter, syncWithRetry } from './sync/openrouter-sync';
export type { SyncResult } from './sync/openrouter-sync';
export { eagerSyncIfStale } from './sync/eager-sync';
export { isRegistryStale, MODEL_SYNC_CRON } from './sync/model-sync-scheduler';

// Sync alert webhook
export { sendSyncFailureWebhook, sendTestWebhook } from './notifications/sync-alert-webhook';
export type { SyncFailureContext, TestWebhookResult } from './notifications/sync-alert-webhook';
