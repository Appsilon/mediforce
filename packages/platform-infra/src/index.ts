// Firebase abstraction implementations
export { FirestoreAgentEventRepository } from './firestore/agent-event-repository';
export { FirestoreAuditRepository } from './firestore/audit-repository';
export {
  FirestoreProcessRepository,
  WorkflowDefinitionVersionAlreadyExistsError,
  WorkflowDefinitionVersionNotFoundError,
} from './firestore/process-repository';
export { FirestoreProcessInstanceRepository } from './firestore/process-instance-repository';
export { FirebaseAuthService } from './auth/firebase-auth-service';
export { FirebaseUserDirectoryService } from './auth/firebase-user-directory-service';
export {
  initializeFirebase,
  getFirestoreDb,
  getFirebaseAuth,
} from './config/firebase-init';
export type { FirebaseConfig } from './config/firebase-init';
export { FirestoreHumanTaskRepository } from './firestore/human-task-repository';
export { FirestoreAgentRunRepository } from './firestore/agent-run-repository';
export { FirestoreHandoffRepository } from './firestore/handoff-repository';
export { MailgunNotificationService } from './notifications/mailgun-notification-service';
export { WebhookNotificationService } from './notifications/webhook-notification-service';
export { createMailgunSender } from './email/mailgun-client';
export type { MailgunConfig } from './email/mailgun-client';
export { FirestoreAgentDefinitionRepository } from './firestore/agent-definition-repository';
export { FirestoreNamespaceRepository } from './firestore/namespace-repository';
export { FirestoreUserProfileRepository } from './firestore/user-profile-repository';
export { FirestoreWorkflowSecretsRepository } from './firestore/workflow-secrets-repository';
export { FirestoreNamespaceSecretsRepository } from './firestore/namespace-secrets-repository';
export { FirestoreCoworkSessionRepository } from './firestore/cowork-session-repository';
export { FirestoreCronTriggerStateRepository } from './firestore/cron-trigger-state-repository';
export { FirestoreToolCatalogRepository } from './firestore/tool-catalog-repository';
export { PostgresToolCatalogRepository } from './postgres/repositories/tool-catalog-repository';
export { createPostgresClient, getSharedPostgresClient } from './postgres/client';
export type { Database } from './postgres/client';
export { FirestoreOAuthProviderRepository } from './firestore/oauth-provider-repository';
export { FirestoreAgentOAuthTokenRepository } from './firestore/agent-oauth-token-repository';
export { validateSecretsKey } from './crypto/secrets-cipher';
export { getAdminAuth, getAdminFirestore } from './auth/firebase-admin-init';
export { FirebaseInviteService } from './auth/firebase-invite-service';
export { backfillInstanceNamespaces } from './migrations/backfill-instance-namespaces';
export { FirestoreModelRegistryRepository } from './firestore/model-registry-repository';
export { syncFromOpenRouter } from './sync/openrouter-sync';

