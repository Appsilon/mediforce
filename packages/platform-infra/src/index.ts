// Firestore read ports for the two domains still served from Firebase
// (agent-event log, user profile) — Auth-adjacent, out of ADR-0001 scope.
export { FirestoreAgentEventRepository } from './firestore/agent-event-repository';
export { FirestoreUserProfileRepository } from './firestore/user-profile-repository';

// Auth / Firebase wiring (kept — Firebase Auth is the identity provider).
export { FirebaseAuthService } from './auth/firebase-auth-service';
export { FirebaseUserDirectoryService } from './auth/firebase-user-directory-service';
export { FirebaseInviteService } from './auth/firebase-invite-service';
export { getAdminAuth, getAdminFirestore } from './auth/firebase-admin-init';
export {
  initializeFirebase,
  getFirestoreDb,
  getFirebaseAuth,
} from './config/firebase-init';
export type { FirebaseConfig } from './config/firebase-init';

// Notifications + email
export { MailgunNotificationService } from './notifications/mailgun-notification-service';
export { WebhookNotificationService } from './notifications/webhook-notification-service';
export { createMailgunSender } from './email/mailgun-client';
export type { MailgunConfig } from './email/mailgun-client';

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
export { createPostgresClient, getSharedPostgresClient } from './postgres/client';
export type { Database } from './postgres/client';
export { PostgresAgentEventLog } from './postgres/agent-event-log';

// Crypto + sync
export { validateSecretsKey } from './crypto/secrets-cipher';
export { syncFromOpenRouter } from './sync/openrouter-sync';
