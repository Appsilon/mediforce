// Firebase abstraction implementations
export { FirestoreAuditRepository } from './firestore/audit-repository.js';
export {
  FirestoreProcessRepository,
  WorkflowDefinitionVersionAlreadyExistsError,
  WorkflowDefinitionVersionNotFoundError,
} from './firestore/process-repository.js';
export { FirestoreProcessInstanceRepository } from './firestore/process-instance-repository.js';
export { FirebaseAuthService } from './auth/firebase-auth-service.js';
export { FirebaseUserDirectoryService } from './auth/firebase-user-directory-service.js';
export {
  initializeFirebase,
  getFirestoreDb,
  getFirebaseAuth,
} from './config/firebase-init.js';
export type { FirebaseConfig } from './config/firebase-init.js';
export { FirestoreHumanTaskRepository } from './firestore/human-task-repository.js';
export { FirestoreAgentRunRepository } from './firestore/agent-run-repository.js';
export { FirestoreHandoffRepository } from './firestore/handoff-repository.js';
export { MailgunNotificationService } from './notifications/mailgun-notification-service.js';
export { WebhookNotificationService } from './notifications/webhook-notification-service.js';
export { createMailgunSender } from './email/mailgun-client.js';
export type { MailgunConfig } from './email/mailgun-client.js';
export { FirestoreAgentDefinitionRepository } from './firestore/agent-definition-repository.js';
export { FirestoreNamespaceRepository } from './firestore/namespace-repository.js';
export { FirestoreWorkflowSecretsRepository } from './firestore/workflow-secrets-repository.js';
export { FirestoreNamespaceSecretsRepository } from './firestore/namespace-secrets-repository.js';
export { FirestoreCoworkSessionRepository } from './firestore/cowork-session-repository.js';
export { FirestoreCronTriggerStateRepository } from './firestore/cron-trigger-state-repository.js';
export { FirestoreToolCatalogRepository } from './firestore/tool-catalog-repository.js';
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
export { createPostgresClient, getSharedPostgresClient } from './postgres/client.js';
export type { Database } from './postgres/client.js';
export { PostgresAgentEventLog } from './postgres/agent-event-log.js';
export { FirestoreOAuthProviderRepository } from './firestore/oauth-provider-repository.js';
export { FirestoreAgentOAuthTokenRepository } from './firestore/agent-oauth-token-repository.js';
export { validateSecretsKey } from './crypto/secrets-cipher.js';
export { getAdminAuth, getAdminFirestore } from './auth/firebase-admin-init.js';
export { FirebaseInviteService } from './auth/firebase-invite-service.js';
export { backfillInstanceNamespaces } from './migrations/backfill-instance-namespaces.js';
export { FirestoreModelRegistryRepository } from './firestore/model-registry-repository.js';
export { PostgresModelRegistryRepository } from './postgres/repositories/model-registry-repository.js';
export { PostgresNamespaceSecretsRepository } from './postgres/repositories/namespace-secrets-repository.js';
export { PostgresWorkflowSecretsRepository } from './postgres/repositories/workflow-secrets-repository.js';
export { syncFromOpenRouter } from './sync/openrouter-sync.js';

