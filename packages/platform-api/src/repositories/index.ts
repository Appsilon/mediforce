// Authorization wrapper layer (ADR-0004). Every API handler accepts a
// `CallerScope` instead of raw repositories; the wrappers enforce workspace
// membership + visibility on every read and write.
export { AuthorizedRepository } from './authorized-repository.js';
export type { CallerScope, PluginsRegistryView, NamespaceLookupView, SystemServices } from './caller-scope.js';
export { createCallerScope } from './create-caller-scope.js';
export type { CallerScopeServices } from './create-caller-scope.js';

export type { AuthorizedHumanTaskRepository } from './authorized-human-task-repository.js';
export { AuthorizedHumanTaskRepositoryImpl } from './authorized-human-task-repository.js';
export type { AuthorizedWorkflowRunRepository } from './authorized-workflow-run-repository.js';
export { AuthorizedWorkflowRunRepositoryImpl } from './authorized-workflow-run-repository.js';
export type { AuthorizedWorkflowDefinitionRepository } from './authorized-workflow-definition-repository.js';
export { AuthorizedWorkflowDefinitionRepositoryImpl } from './authorized-workflow-definition-repository.js';
export type { AuthorizedAgentDefinitionRepository } from './authorized-agent-definition-repository.js';
export { AuthorizedAgentDefinitionRepositoryImpl } from './authorized-agent-definition-repository.js';
export type { AuthorizedCoworkSessionRepository } from './authorized-cowork-session-repository.js';
export { AuthorizedCoworkSessionRepositoryImpl } from './authorized-cowork-session-repository.js';
export type { AuthorizedAgentRunRepository } from './authorized-agent-run-repository.js';
export { AuthorizedAgentRunRepositoryImpl } from './authorized-agent-run-repository.js';
export type { AuthorizedAuditEventRepository } from './authorized-audit-event-repository.js';
export { AuthorizedAuditEventRepositoryImpl } from './authorized-audit-event-repository.js';
export type { AuthorizedHandoffRepository } from './authorized-handoff-repository.js';
export { AuthorizedHandoffRepositoryImpl } from './authorized-handoff-repository.js';
export type { AuthorizedToolCatalogRepository } from './authorized-tool-catalog-repository.js';
export { AuthorizedToolCatalogRepositoryImpl } from './authorized-tool-catalog-repository.js';
export type { AuthorizedOAuthProviderRepository } from './authorized-oauth-provider-repository.js';
export { AuthorizedOAuthProviderRepositoryImpl } from './authorized-oauth-provider-repository.js';
export type { AuthorizedAgentOAuthTokenRepository } from './authorized-agent-oauth-token-repository.js';
export { AuthorizedAgentOAuthTokenRepositoryImpl } from './authorized-agent-oauth-token-repository.js';
export type { AuthorizedWorkspaceSecretRepository, NamespaceSecretsRepositoryView } from './authorized-workspace-secret-repository.js';
export { AuthorizedWorkspaceSecretRepositoryImpl } from './authorized-workspace-secret-repository.js';
export type { AuthorizedWorkflowSecretRepository, WorkflowSecretsRepositoryView } from './authorized-workflow-secret-repository.js';
export { AuthorizedWorkflowSecretRepositoryImpl } from './authorized-workflow-secret-repository.js';
