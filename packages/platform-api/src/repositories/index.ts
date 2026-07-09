// Authorization wrapper layer (ADR-0004). Every API handler accepts a
// `CallerScope` instead of raw repositories; the wrappers enforce workspace
// membership + visibility on every read and write.
export { AuthorizedScope } from './authorized-repository';
export type { CallerScope, PluginsRegistryView, SystemServices } from './caller-scope';
export { createCallerScope } from './create-caller-scope';
export type { CallerScopeServices } from './create-caller-scope';

export { AuthorizedHumanTaskRepository } from './authorized-human-task-repository';
export { AuthorizedWorkflowRunRepository } from './authorized-workflow-run-repository';
export { AuthorizedWorkflowDefinitionRepository } from './authorized-workflow-definition-repository';
export { AuthorizedAgentDefinitionRepository } from './authorized-agent-definition-repository';
export { AuthorizedCoworkSessionRepository } from './authorized-cowork-session-repository';
export { AuthorizedAgentRunRepository } from './authorized-agent-run-repository';
export { AuthorizedAuditEventRepository } from './authorized-audit-event-repository';
export { AuthorizedHandoffRepository } from './authorized-handoff-repository';
export { AuthorizedTaskAttachmentRepository } from './authorized-task-attachment-repository';
export { AuthorizedToolCatalogRepository } from './authorized-tool-catalog-repository';
export { AuthorizedOAuthProviderRepository } from './authorized-oauth-provider-repository';
export { AuthorizedAgentOAuthTokenRepository } from './authorized-agent-oauth-token-repository';
export { AuthorizedWorkspaceSecretRepository } from './authorized-workspace-secret-repository';
export { AuthorizedWorkflowSecretRepository } from './authorized-workflow-secret-repository';
