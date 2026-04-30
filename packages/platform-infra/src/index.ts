// Firebase abstraction implementations
export { FirestoreAuditRepository } from './firestore/audit-repository.js';
export {
  FirestoreProcessRepository,
  WorkflowDefinitionVersionAlreadyExistsError,
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
export type { MailgunConfig, SendEmailParams, SendEmailResult } from './email/mailgun-client.js';
export { FirestoreAgentDefinitionRepository } from './firestore/agent-definition-repository.js';
export { FirestoreNamespaceRepository } from './firestore/namespace-repository.js';
export { FirestoreWorkflowSecretsRepository } from './firestore/workflow-secrets-repository.js';
export { FirestoreCoworkSessionRepository } from './firestore/cowork-session-repository.js';
export { FirestoreCronTriggerStateRepository } from './firestore/cron-trigger-state-repository.js';
export { FirestoreToolCatalogRepository } from './firestore/tool-catalog-repository.js';
export { FirestoreOAuthProviderRepository } from './firestore/oauth-provider-repository.js';
export { FirestoreAgentOAuthTokenRepository } from './firestore/agent-oauth-token-repository.js';
export { validateSecretsKey } from './crypto/secrets-cipher.js';
export { getAdminAuth, getAdminFirestore } from './auth/firebase-admin-init.js';
export { FirebaseInviteService } from './auth/firebase-invite-service.js';

