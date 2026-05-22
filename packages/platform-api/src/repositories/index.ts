// Authorization wrapper layer (ADR-0004). Every API handler accepts a
// `CallerScope` instead of raw repositories; the wrappers enforce workspace
// membership + visibility on every read and write.
export { AuthorizedScope } from './authorized-repository.js';
export type { CallerScope, PluginsRegistryView, SystemServices } from './caller-scope.js';
export { createCallerScope } from './create-caller-scope.js';
export type { CallerScopeServices } from './create-caller-scope.js';

export { AuthorizedHumanTaskRepository } from './authorized-human-task-repository.js';
export { AuthorizedWorkflowRunRepository } from './authorized-workflow-run-repository.js';
export { AuthorizedWorkflowDefinitionRepository } from './authorized-workflow-definition-repository.js';
export { AuthorizedAgentDefinitionRepository } from './authorized-agent-definition-repository.js';
export { AuthorizedCoworkSessionRepository } from './authorized-cowork-session-repository.js';
export { AuthorizedAgentRunRepository } from './authorized-agent-run-repository.js';
export { AuthorizedAuditEventRepository } from './authorized-audit-event-repository.js';
export { AuthorizedHandoffRepository } from './authorized-handoff-repository.js';
export { AuthorizedToolCatalogRepository } from './authorized-tool-catalog-repository.js';
export { AuthorizedOAuthProviderRepository } from './authorized-oauth-provider-repository.js';
export { AuthorizedAgentOAuthTokenRepository } from './authorized-agent-oauth-token-repository.js';
export { AuthorizedWorkspaceSecretRepository } from './authorized-workspace-secret-repository.js';
export { AuthorizedWorkflowSecretRepository } from './authorized-workflow-secret-repository.js';
