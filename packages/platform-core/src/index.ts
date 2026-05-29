// Cross-backend domain errors
export {
  WorkflowDefinitionVersionAlreadyExistsError,
  WorkflowDefinitionVersionNotFoundError,
} from './errors';

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
  TokenUsageSchema,
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
  WorkflowVisibilitySchema,
  WorkflowDefinitionSchema,
  WorkflowDefinitionBaseSchema,
  WorkflowTemplateSchema,
  InputForNextRunEntrySchema,
  TriggerInputFieldSchema,
  HttpMethodSchema,
  WebhookTriggerConfigSchema,
  HttpActionConfigSchema,
  ReshapeActionConfigSchema,
  EmailActionConfigSchema,
  SpawnTargetSchema,
  SpawnActionConfigSchema,
  WaitActionConfigSchema,
  ActionConfigSchema,
  validateInputForNextRun,
  validateExecutorAndTriggers,
  validateTriggerInput,
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
  NamespaceMembershipSchema,
  HandleSchema,
  HANDLE_REGEX,
  HANDLE_MAX_LENGTH,
  WorkflowSecretsSchema,
  NamespaceSecretsSchema,
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
  buildTaskVerdicts,
  defaultVerdictIntent,
  defaultVerdictLabel,
  defaultRequiresComment,
  AttachmentSchema,
  AssignmentItemSchema,
  TableEditorRowSchema,
  CompleteHumanTaskPayloadSchema,
} from './schemas/index';

export type { Handle } from './schemas/handle';

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
  TokenUsage,
  Presentation,
  AgentEvent,
  AgentRunStatus,
  AgentRun,
} from './types/index';

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
  WorkflowVisibility,
  WorkflowDefinition,
  WorkflowTemplate,
  TriggerInputField,
  HttpMethod,
  WebhookTriggerConfig,
  HttpActionConfig,
  ReshapeActionConfig,
  EmailActionConfig,
  SpawnTargetConfig,
  SpawnActionConfig,
  WaitActionConfig,
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
  NamespaceMembership,
  WorkflowSecrets,
  NamespaceSecrets,
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
  TaskVerdict,
  Attachment,
  AssignmentItem,
  TableEditorRow,
  CompleteHumanTaskPayload,
} from './schemas/index';

// Interfaces (repository and service contracts)
export type {
  AgentEventRepository,
  AuditRepository,
  AuthService,
  AuthUser,
  ProcessRepository,
  WorkflowDefinitionListResult,
  WorkflowDefinitionGroup,
  ProcessInstanceRepository,
  ListInstancesOptions,
  WorkflowRunSummaryResult,
  HumanTaskRepository,
  HandoffRepository,
  NotificationService,
  NotificationEvent,
  UserDirectoryService,
  DirectoryUser,
  UserAuthMetadata,
  AgentRunRepository,
  ListAgentRunsOptions,
  ListAgentRunsPage,
  CoworkSessionRepository,
  CronTriggerStateRepository,
  ToolCatalogRepository,
  NamespaceRepository,
  NamespaceUpdates,
  NamespaceSecretsRepository,
  UserProfile,
  UserProfileRepository,
  WorkflowSecretsRepository,
  SendEmailParams,
  SendEmailResult,
  SendEmailFn,
} from './interfaces/index';

export { encodeCursor, decodeCursor } from './cursors/cursor';
export {
  encodeAgentRunCursor,
  decodeAgentRunCursor,
} from './cursors/agent-run-cursor';
export type { AgentRunCursorPayload } from './cursors/agent-run-cursor';

// Agent definition schema + repository interface
export {
  AgentDefinitionSchema,
  AgentVisibilitySchema,
  CreateAgentDefinitionInputSchema,
  UpdateAgentDefinitionInputSchema,
} from './schemas/agent-definition';
export type {
  AgentDefinition,
  AgentVisibility,
  CreateAgentDefinitionInput,
  UpdateAgentDefinitionInput,
} from './schemas/agent-definition';
export type { AgentDefinitionRepository } from './repositories/agent-definition-repository';

// Model registry schema + repository interface
export {
  ModelRegistryEntrySchema,
  ModelRegistryMetaSchema,
  CreateModelRegistryEntryInputSchema,
  UpdateModelRegistryEntryInputSchema,
  UpdateRankingsInputSchema,
} from './schemas/model-registry';
export type {
  ModelRegistryEntry,
  ModelRegistryMeta,
  CreateModelRegistryEntryInput,
  UpdateModelRegistryEntryInput,
  UpdateRankingsInput,
} from './schemas/model-registry';
export type { ModelRegistryRepository } from './repositories/model-registry-repository';

// OAuth — Step 5
export {
  OAuthProviderConfigSchema,
  PublicOAuthProviderConfigSchema,
  CreateOAuthProviderInputSchema,
  UpdateOAuthProviderInputSchema,
  OAUTH_PROVIDER_PRESETS,
} from './schemas/oauth-provider';
export type {
  OAuthProviderConfig,
  PublicOAuthProviderConfig,
  CreateOAuthProviderInput,
  UpdateOAuthProviderInput,
} from './schemas/oauth-provider';
export {
  AgentOAuthTokenSchema,
  PublicAgentOAuthTokenSchema,
} from './schemas/agent-oauth-token';
export type {
  AgentOAuthToken,
  PublicAgentOAuthToken,
} from './schemas/agent-oauth-token';
export {
  ProviderAlreadyExistsError,
  type OAuthProviderRepository,
} from './repositories/oauth-provider-repository';
export type { AgentOAuthTokenRepository } from './repositories/agent-oauth-token-repository';

// Parser (YAML process definition parsing)
export { parseProcessDefinition, type ParseResult } from './parser/index';
export { formatZodErrors } from './parser/index';

// Testing utilities (in-memory implementations for test doubles)
export {
  InMemoryAgentEventRepository,
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
  InMemoryAgentRunRepository,
  // Test factories
  buildProcessDefinition,
  buildProcessInstance,
  buildStepExecution,
  buildHumanTask,
  buildAgentRun,
  buildAgentEvent,
  buildAuditEvent,
  buildProcessConfig,
  buildWorkflowDefinition,
  buildAgentOutputEnvelope,
  buildFileMetadata,
  buildCoworkSession,
  resetFactorySequence,
} from './testing/index';

// Validation
export { validateProcessConfig } from './validation/config-validator';
export type { ConfigValidationResult } from './validation/config-validator';
export { validatePayload } from './validation/payload-validator';
export type { PayloadValidationError, PayloadValidationResult } from './validation/payload-validator';

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
} from './mcp/resolve-effective-mcp';

// Collaboration (handoff registry, RBAC)
export { handoffTypeRegistry, RbacService, RbacError } from './collaboration/index';
export type { HandoffTypeRegistration } from './collaboration/index';

// Interpolation (shared across workflow-engine + core-actions)
export {
  getPath,
  interpolate,
  type InterpolationSources,
} from './interpolation';

// Utils (zero-dep helpers shared across runtime + worker)
export { createLineStreamReader } from './utils/line-stream';
export type { LineStreamReader } from './utils/line-stream';
export { calculateEstimatedCost } from './utils/cost';
