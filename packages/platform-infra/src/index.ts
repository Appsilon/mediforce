// Auth / Firebase wiring (kept — Firebase Auth is the identity provider).
export { FirebaseAuthService } from './auth/firebase-auth-service.js';
export { FirebaseUserDirectoryService } from './auth/firebase-user-directory-service.js';
export { FirebaseInviteService } from './auth/firebase-invite-service.js';
export { getAdminAuth, getAdminFirestore } from './auth/firebase-admin-init.js';
export {
  initializeFirebase,
  getFirestoreDb,
  getFirebaseAuth,
} from './config/firebase-init.js';
export type { FirebaseConfig } from './config/firebase-init.js';

// Notifications + email
export { MailgunNotificationService } from './notifications/mailgun-notification-service.js';
export { WebhookNotificationService } from './notifications/webhook-notification-service.js';
export { createMailgunSender } from './email/mailgun-client.js';
export type { MailgunConfig } from './email/mailgun-client.js';

// Postgres repositories — the only data backend (ADR-0001 PR2).
export { PostgresToolCatalogRepository } from './postgres/repositories/tool-catalog-repository.js';
export { PostgresNamespaceRepository } from './postgres/repositories/namespace-repository.js';
export { PostgresAuditRepository } from './postgres/repositories/audit-repository.js';
export { PostgresOAuthProviderRepository } from './postgres/repositories/oauth-provider-repository.js';
export { PostgresAgentOAuthTokenRepository } from './postgres/repositories/agent-oauth-token-repository.js';
export { PostgresCronTriggerStateRepository } from './postgres/repositories/cron-trigger-state-repository.js';
export { PostgresAgentRunRepository } from './postgres/repositories/agent-run-repository.js';
export { PostgresHumanTaskRepository } from './postgres/repositories/human-task-repository.js';
export { PostgresHandoffRepository } from './postgres/repositories/handoff-repository.js';
export { PostgresCoworkSessionRepository } from './postgres/repositories/cowork-session-repository.js';
export { PostgresProcessInstanceRepository } from './postgres/repositories/process-instance-repository.js';
export { PostgresProcessRepository } from './postgres/repositories/process-repository.js';
export { PostgresAgentDefinitionRepository } from './postgres/repositories/agent-definition-repository.js';
export { PostgresModelRegistryRepository } from './postgres/repositories/model-registry-repository.js';
export { PostgresNamespaceSecretsRepository } from './postgres/repositories/namespace-secrets-repository.js';
export { PostgresWorkflowSecretsRepository } from './postgres/repositories/workflow-secrets-repository.js';
export { createPostgresClient, getSharedPostgresClient } from './postgres/client.js';
export type { Database } from './postgres/client.js';
export { PostgresAgentEventLog } from './postgres/agent-event-log.js';

// Crypto + sync
export { validateSecretsKey } from './crypto/secrets-cipher.js';
export { syncFromOpenRouter } from './sync/openrouter-sync.js';
