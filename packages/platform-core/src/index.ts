// Cross-backend domain errors
export {
  MemberNotInNamespaceError,
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
  RunNameEntrySchema,
  RunDefinitionPinSchema,
  WorkflowDisplayStatusSchema,
  StepExecutionStatusSchema,
  GateResultSchema,
  ReviewVerdictSchema,
  AgentOutputSnapshotSchema,
  StepExecutionSchema,
  AnnotationSchema,
  StepOutputEnvelopeSchema,
  AgentOutputEnvelopeSchema,
  GitMetadataSchema,
  TokenUsageSchema,
  AgentEventSchema,
  AgentRunStatusSchema,
  AgentRunSchema,
  AgentRunCardStatusSchema,
  HumanTaskStatusSchema,
  HumanTaskSchema,
  HandoffStatusSchema,
  HandoffEntitySchema,
  NotificationTargetSchema,
  PluginRoleSchema,
  PluginCapabilityMetadataSchema,
  ContainerSchema,
  WorkflowAgentConfigSchema,
  ScriptStepConfigSchema,
  DatabricksJobConfigSchema,
  resolveStepTimeoutMinutes,
  resolveStepTimeoutMs,
  resolveStrandedBudgetMs,
  STRANDED_STEP_GRACE_MS,
  WorkflowCoworkConfigSchema,
  WorkflowReviewConfigSchema,
  WorkflowWorkspaceSchema,
  WorkflowStepSchema,
  WorkflowVisibilitySchema,
  WorkflowAccessSchema,
  OPEN_WORKFLOW_ACCESS,
  isOpenWorkflowAccess,
  BUILTIN_ROLES,
  WORKFLOW_MANAGER_ROLE,
  DEFAULT_WORKFLOW_ACCESS,
  DEFAULT_STEP_ALLOWED_ROLES,
  builtinRoleIds,
  builtinRolesWithVerb,
  findBuiltinRole,
  withBuiltinAccessFloor,
  withBuiltinStepFloor,
  pinnedRolesForVerb,
  WorkflowAuthorableSchema,
  SERVER_MANAGED_WORKFLOW_FIELDS,
  WorkflowSourceSchema,
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
  validateSteps,
  validateTriggerInput,
  parseWorkflowDefinitionForCreation,
  parseWorkflowTemplate,
  getWorkflowAuthorableJsonSchema,
  resolveCoworkOutputSchema,
  ConversationTurnSchema,
  CoworkAgentSchema,
  CoworkVoiceConfigSchema,
  CoworkSessionStatusSchema,
  CoworkSessionSchema,
  NamespaceTypeSchema,
  NamespaceSchema,
  NamespaceMemberSchema,
  NamespaceMembershipSchema,
  BrandColorSchema,
  WorkspaceLogoSchema,
  WORKSPACE_LOGO_MAX_CHARS,
  HandleSchema,
  HANDLE_REGEX,
  HANDLE_MAX_LENGTH,
  WorkflowSecretsSchema,
  NamespaceSecretsSchema,
  TriggerTypeSchema,
  TriggerResourceSchema,
  CronTriggerResourceSchema,
  WebhookTriggerResourceSchema,
  ManualTriggerResourceSchema,
  CronTriggerConfigSchema,
  ManualTriggerConfigSchema,
  PortableTriggerSchema,
  TriggerConfigFileSchema,
  toPortableTrigger,
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
  ImageCatalogSourceSchema,
  ImageCatalogDeclaredSourceSchema,
  ImageCatalogEntrySchema,
  ImageRuntimeSchema,
  KnownImageCapabilitiesSchema,
  UnknownImageCapabilitiesSchema,
  ImageCapabilitiesSchema,
  ImageCapabilityCacheSchema,
  parseImageCapabilities,
  unknownImageCapabilities,
  buildTaskVerdicts,
  defaultVerdictIntent,
  defaultVerdictLabel,
  defaultRequiresComment,
  AttachmentSchema,
  AssignmentItemSchema,
  TableEditorRowSchema,
  CompleteHumanTaskPayloadSchema,
  toProcessDefinition,
  mergeVerdictTransitions,
  ensureEntryStepFirst,
  validateStepReferences,
  type ReferenceIssue,
  validateStepGraph,
  validateWorkflowGraphAndReferences,
  type ValidationResult,
  type WorkflowGraphValidation,
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
  RunNameEntry,
  RunDefinitionPin,
  WorkflowDisplayStatus,
  StepExecutionStatus,
  GateResult,
  ReviewVerdict,
  AgentOutputSnapshot,
  StepExecution,
  Annotation,
  StepOutputEnvelope,
  AgentOutputEnvelope,
  GitMetadata,
  TokenUsage,
  Presentation,
  AgentEvent,
  AgentRunStatus,
  AgentRun,
  AgentRunCardStatus,
} from './types/index';

export type {
  HumanTaskStatus,
  HumanTask,
  HandoffStatus,
  HandoffEntity,
  NotificationTarget,
  ProcessNotificationConfig,
  PluginCapabilityMetadata,
  ContainerConfig,
  WorkflowAgentConfig,
  ScriptStepConfig,
  DatabricksJobConfig,
  WorkflowCoworkConfig,
  WorkflowReviewConfig,
  WorkflowWorkspace,
  WorkflowStep,
  WorkflowVisibility,
  WorkflowAccess,
  BuiltinRole,
  RoleVerb,
  WorkflowSource,
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
  OutputSchemaShape,
  NamespaceType,
  Namespace,
  NamespaceMember,
  NamespaceMembership,
  WorkflowSecrets,
  NamespaceSecrets,
  TriggerType,
  TriggerResource,
  CronTriggerResource,
  WebhookTriggerResource,
  ManualTriggerResource,
  TriggerConfig,
  PortableTrigger,
  TriggerConfigFile,
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
  ImageCatalogSource,
  ImageCatalogDeclaredSource,
  ImageCatalogEntry,
  ImageRuntime,
  ImageCapabilities,
  ImageCapabilityCache,
  TaskVerdict,
  Attachment,
  AssignmentItem,
  TableEditorRow,
  CompleteHumanTaskPayload,
  TaskAttachment,
  NewTaskAttachment,
} from './schemas/index';
export {
  ATTACHMENT_MAX_BYTES,
  TaskAttachmentSchema,
  NewTaskAttachmentSchema,
} from './schemas/index';
export {
  AddStepToolSchema,
  UpdateStepToolSchema,
  RemoveStepToolSchema,
  ListModelsToolSchema,
  WORKFLOW_ASSISTANT_TOOLS,
  WORKFLOW_ASSISTANT_DEFAULT_MODEL,
  WorkflowAssistantToolCallSchema,
  applyWorkflowAssistantToolCalls,
  type AddStepTool,
  type UpdateStepTool,
  type RemoveStepTool,
  type ListModelsTool,
  type WorkflowAssistantToolName,
  type WorkflowAssistantToolCall,
  type ToolCallOutcome,
  type ApplyToolCallsResult,
} from './schemas/index';

// Interfaces (repository and service contracts)
export type {
  AgentEventRepository,
  AuditRepository,
  GetByNamespaceOptions,
  GetByNamespacePage,
  ProcessRepository,
  WorkflowDefinitionListResult,
  WorkflowDefinitionGroup,
  ProcessInstanceRepository,
  ListInstancesOptions,
  ListInstancesPageOptions,
  ListInstancesPage,
  WorkflowDisplayStatusCounts,
  WorkflowRunSummaryResult,
  HumanTaskRepository,
  TaskAttachmentRepository,
  BlobStore,
  HandoffRepository,
  NotificationService,
  NotificationEvent,
  UserDirectoryService,
  DirectoryUser,
  UserAuthMetadata,
  RoleGrant,
  AgentRunRepository,
  ListAgentRunsOptions,
  ListAgentRunsPage,
  AgentRunCardStatusCounts,
  CoworkSessionRepository,
  TriggerRepository,
  TriggerUpdate,
  ToolCatalogRepository,
  ImageCatalogRepository,
  NamespaceRepository,
  NamespaceUpdates,
  NamespaceSecretsRepository,
  UserProfile,
  UserProfileRepository,
  CredentialsRepository,
  WorkflowSecretsRepository,
  SendEmailParams,
  SendEmailResult,
  SendEmailFn,
  EmailProviderInfo,
} from './interfaces/index';

export { formatRoleGrant } from './interfaces/index';

export { encodeCursor, decodeCursor } from './cursors/cursor';
export {
  encodeAgentRunCursor,
  decodeAgentRunCursor,
} from './cursors/agent-run-cursor';
export type { AgentRunCursorPayload } from './cursors/agent-run-cursor';
export {
  encodeProcessInstanceCursor,
  decodeProcessInstanceCursor,
} from './cursors/process-instance-cursor';
export type { ProcessInstanceCursorPayload } from './cursors/process-instance-cursor';
export {
  encodeAuditEventCursor,
  decodeAuditEventCursor,
} from './cursors/audit-event-cursor';
export type { AuditEventCursorPayload } from './cursors/audit-event-cursor';

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
export type { PlatformSettingsRepository } from './repositories/platform-settings-repository';

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
  InMemoryProcessInstanceRepository,
  InMemoryHumanTaskRepository,
  InMemoryHandoffRepository,
  NoopNotificationService,
  InMemoryCoworkSessionRepository,
  InMemoryTriggerRepository,
  InMemoryOAuthProviderRepository,
  InMemoryAgentOAuthTokenRepository,
  InMemoryAgentRunRepository,
  InMemoryPlatformSettingsRepository,
  InMemoryUserDirectoryService,
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
  buildStepOutputEnvelope,
  buildAgentOutputEnvelope,
  buildFileMetadata,
  buildCoworkSession,
  resetFactorySequence,
} from './testing/index';

// Validation
export { validateProcessConfig } from './validation/config-validator';
export type { ConfigValidationResult } from './validation/config-validator';
export { isJsonObject, validatePayload } from './validation/payload-validator';
export type { PayloadValidationError, PayloadValidationResult } from './validation/payload-validator';

// Version resolution — the one policy every unpinned firing resolves through
export {
  RUNNABLE_VERSION_REASONS,
  pickRunnableVersion,
  resolveRunnableVersion,
  toWorkflowVersionSource,
} from './workflows/resolve-runnable-version';
export type {
  RunnableVersion,
  RunnableVersionReason,
  VersionCandidate,
  WorkflowVersionSource,
} from './workflows/resolve-runnable-version';

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

// Collaboration (handoff registry)
export { handoffTypeRegistry } from './collaboration/index';
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
export { formatBytes } from './utils/format';
export { compact, parseRow } from './utils/compact';
export { normaliseModelId } from './utils/normalise-model-id';
export { emailLayout, escapeHtml } from './utils/email-layout';
export { isPasswordAuthEnabled, parseAutoJoinWorkspaces, autoJoinHandlesForEmail } from './utils/auth-env';
export type { AutoJoinRule } from './utils/auth-env';
export { DOCKER_IMAGE_SETUP_URL, VERIFY_WORKFLOW_URL, CREATE_WORKFLOW_URL } from './utils/docs-links';
export { DEFAULT_AGENT_IMAGE } from './utils/container-defaults';
export {
  normalizeRepoUrls,
  toHttpsWithToken,
  resolveRepoCloneTargets,
  redactRepoCredentials,
} from './utils/repo-url';
export type { RepoCloneTarget } from './utils/repo-url';
export {
  BUILD_LABELS,
  OCI_LABELS,
  IMAGE_LABELS_FORMAT,
  buildProvenanceLabelArgs,
  imageLabelsInspectArgs,
  parseImageProvenance,
  readProvenanceLabels,
  shortImageId,
} from './utils/image-provenance';
export type { ImageProvenance, ReadImageProvenance } from './utils/image-provenance';
export { getWorkflowStatus, type WorkflowStatus } from './utils/workflow-status';
export { toSlug, uniqueName, uniqueSlug } from './utils/slug';

// Pre-made blocks — shared by the Add Block picker and the workflow assistant.
export { BLOCK_PRESETS, BLOCK_CATEGORIES } from './blocks/block-presets';
export type { BlockPreset, BlockPresetPayload, BlockCategory } from './blocks/block-presets';

// Workflow examples — shared loader for MCP tool, tests, and build scripts.
// Uses Node.js fs/path so NOT exported from this barrel (breaks browser bundles).
// Import directly: import { loadWorkflowExamples } from '@mediforce/platform-core/workflow-examples'
