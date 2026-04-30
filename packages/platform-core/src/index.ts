// Schemas (Zod schema objects + inferred types)
export {
  VerdictSchema,
  StepUiSchema,
  StepParamSchema,
  SelectionSchema,
  normalizeSelection,
  StepSchema,
  TransitionSchema,
  TriggerSchema,
  ProcessDefinitionSchema,
  ReviewConstraintsSchema,
  AgentConfigSchema,
  StepConfigSchema,
  ProcessNotificationConfigSchema,
  /** @deprecated Legacy schema -- use WorkflowDefinitionSchema instead */
  ProcessConfigSchema,
  FileMetadataSchema,
  AuditEventSchema,
  StepInputSchema,
  StepOutputSchema,
  InstanceStatusSchema,
  ProcessInstanceSchema,
  StepExecutionStatusSchema,
  GateResultSchema,
  ReviewVerdictSchema,
  AgentOutputSnapshotSchema,
  StepExecutionSchema,
  AnnotationSchema,
  AgentOutputEnvelopeSchema,
  GitMetadataSchema,
  AgentEventSchema,
  AgentRunStatusSchema,
  AgentRunSchema,
  HumanTaskStatusSchema,
  HumanTaskSchema,
  HandoffStatusSchema,
  HandoffEntitySchema,
  NotificationTargetSchema,
  PluginRoleSchema,
  PluginCapabilityMetadataSchema,
  WorkflowAgentConfigSchema,
  WorkflowCoworkConfigSchema,
  WorkflowReviewConfigSchema,
  WorkflowWorkspaceSchema,
  WorkflowStepSchema,
  WorkflowDefinitionSchema,
  WorkflowDefinitionBaseSchema,
  WorkflowTemplateSchema,
  InputForNextRunEntrySchema,
  HttpMethodSchema,
  WebhookTriggerConfigSchema,
  HttpActionConfigSchema,
  ReshapeActionConfigSchema,
  EmailActionConfigSchema,
  ActionConfigSchema,
  validateInputForNextRun,
  validateExecutorAndTriggers,
  parseWorkflowDefinitionForCreation,
  parseWorkflowTemplate,
  ConversationTurnSchema,
  CoworkAgentSchema,
  CoworkVoiceConfigSchema,
  CoworkSessionStatusSchema,
  CoworkSessionSchema,
  NamespaceTypeSchema,
  NamespaceSchema,
  NamespaceMemberSchema,
  WorkflowSecretsSchema,
  CronTriggerStateSchema,
  McpServerConfigSchema,
  AgentMcpBindingSchema,
  AgentMcpBindingMapSchema,
  StdioAgentMcpBindingSchema,
  HttpAgentMcpBindingSchema,
  HttpAuthConfigSchema,
  HttpHeadersAuthSchema,
  HttpOAuthAuthSchema,
  StepMcpRestrictionSchema,
  StepMcpRestrictionEntrySchema,
  ToolCatalogEntrySchema,
} from './schemas/index.js';

// Types (re-exported from schemas for convenience)
export type {
  Verdict,
  StepUi,
  StepParam,
  Selection,
  Step,
  Transition,
  Trigger,
  ProcessDefinition,
  ReviewConstraints,
  AgentConfig,
  StepConfig,
  ProcessConfig,
  FileMetadata,
  AuditEvent,
  StepInput,
  StepOutput,
  InstanceStatus,
  ProcessInstance,
  StepExecutionStatus,
  GateResult,
  ReviewVerdict,
  AgentOutputSnapshot,
  StepExecution,
  Annotation,
  AgentOutputEnvelope,
  GitMetadata,
  AgentEvent,
  AgentRunStatus,
  AgentRun,
} from './types/index.js';

export type {
  HumanTaskStatus,
  HumanTask,
  HandoffStatus,
  HandoffEntity,
  NotificationTarget,
  ProcessNotificationConfig,
  PluginCapabilityMetadata,
  WorkflowAgentConfig,
  WorkflowCoworkConfig,
  WorkflowReviewConfig,
  WorkflowWorkspace,
  WorkflowStep,
  WorkflowDefinition,
  WorkflowTemplate,
  HttpMethod,
  WebhookTriggerConfig,
  HttpActionConfig,
  ReshapeActionConfig,
  EmailActionConfig,
  ActionConfig,
  ConversationTurn,
  HumanTurn,
  AgentTurn,
  ToolTurn,
  CoworkSessionStatus,
  CoworkSession,
  NamespaceType,
  Namespace,
  NamespaceMember,
  WorkflowSecrets,
  CronTriggerState,
  McpServerConfig,
  AgentMcpBinding,
  AgentMcpBindingMap,
  StdioAgentMcpBinding,
  HttpAgentMcpBinding,
  HttpAuthConfig,
  HttpHeadersAuth,
  HttpOAuthAuth,
  StepMcpRestriction,
  StepMcpRestrictionEntry,
  ToolCatalogEntry,
} from './schemas/index.js';

// Interfaces (repository and service contracts)
export type {
  AuditRepository,
  AuthService,
  AuthUser,
  ProcessRepository,
  WorkflowDefinitionListResult,
  WorkflowDefinitionGroup,
  ProcessInstanceRepository,
  HumanTaskRepository,
  HandoffRepository,
  NotificationService,
  NotificationEvent,
  UserDirectoryService,
  DirectoryUser,
  AgentRunRepository,
  CoworkSessionRepository,
  CronTriggerStateRepository,
  ToolCatalogRepository,
  SendEmailParams,
  SendEmailResult,
  SendEmailFn,
} from './interfaces/index.js';

// Agent definition schema + repository interface
export {
  AgentDefinitionSchema,
  CreateAgentDefinitionInputSchema,
  UpdateAgentDefinitionInputSchema,
} from './schemas/agent-definition.js';
export type {
  AgentDefinition,
  CreateAgentDefinitionInput,
  UpdateAgentDefinitionInput,
} from './schemas/agent-definition.js';
export type { AgentDefinitionRepository } from './repositories/agent-definition-repository.js';

// OAuth — Step 5
export {
  OAuthProviderConfigSchema,
  PublicOAuthProviderConfigSchema,
  CreateOAuthProviderInputSchema,
  UpdateOAuthProviderInputSchema,
  OAUTH_PROVIDER_PRESETS,
} from './schemas/oauth-provider.js';
export type {
  OAuthProviderConfig,
  PublicOAuthProviderConfig,
  CreateOAuthProviderInput,
  UpdateOAuthProviderInput,
} from './schemas/oauth-provider.js';
export {
  AgentOAuthTokenSchema,
  PublicAgentOAuthTokenSchema,
} from './schemas/agent-oauth-token.js';
export type {
  AgentOAuthToken,
  PublicAgentOAuthToken,
} from './schemas/agent-oauth-token.js';
export {
  ProviderAlreadyExistsError,
  type OAuthProviderRepository,
} from './repositories/oauth-provider-repository.js';
export type { AgentOAuthTokenRepository } from './repositories/agent-oauth-token-repository.js';

// Parser (YAML process definition parsing)
export { parseProcessDefinition, type ParseResult } from './parser/index.js';
export { formatZodErrors } from './parser/index.js';

// Testing utilities (in-memory implementations for test doubles)
export {
  InMemoryAuditRepository,
  InMemoryProcessRepository,
  InMemoryAuthService,
  InMemoryProcessInstanceRepository,
  InMemoryHumanTaskRepository,
  InMemoryHandoffRepository,
  NoopNotificationService,
  InMemoryCoworkSessionRepository,
  InMemoryCronTriggerStateRepository,
  InMemoryOAuthProviderRepository,
  InMemoryAgentOAuthTokenRepository,
  // Test factories
  buildProcessDefinition,
  buildProcessInstance,
  buildStepExecution,
  buildHumanTask,
  buildAgentRun,
  buildAuditEvent,
  buildProcessConfig,
  buildWorkflowDefinition,
  buildAgentOutputEnvelope,
  buildFileMetadata,
  buildCoworkSession,
  resetFactorySequence,
} from './testing/index.js';

// Validation
export { validateProcessConfig } from './validation/config-validator.js';
export type { ConfigValidationResult } from './validation/config-validator.js';

// MCP resolver (pure; wires AgentDefinition + step restrictions + catalog)
export {
  resolveEffectiveMcp,
  CatalogEntryNotFoundError,
  UnknownRestrictionTargetError,
  DenyToolsWithoutAllowedToolsError,
  type ResolvedMcpConfig,
  type ResolvedMcpServer,
  type ResolvedStdioMcpServer,
  type ResolvedHttpMcpServer,
} from './mcp/resolve-effective-mcp.js';

// Collaboration (handoff registry, RBAC)
export { handoffTypeRegistry, RbacService, RbacError } from './collaboration/index.js';
export type { HandoffTypeRegistration } from './collaboration/index.js';
