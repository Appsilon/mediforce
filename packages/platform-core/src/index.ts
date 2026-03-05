// Schemas (Zod schema objects + inferred types)
export {
  VerdictSchema,
  StepSchema,
  TransitionSchema,
  TriggerSchema,
  ProcessDefinitionSchema,
  ReviewConstraintsSchema,
  StepConfigSchema,
  ProcessNotificationConfigSchema,
  ProcessConfigSchema,
  AuditEventSchema,
  StepInputSchema,
  StepOutputSchema,
  InstanceStatusSchema,
  ProcessInstanceSchema,
  StepExecutionStatusSchema,
  GateResultSchema,
  ReviewVerdictSchema,
  StepExecutionSchema,
  AnnotationSchema,
  AgentOutputEnvelopeSchema,
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
} from './schemas/index.js';

// Types (re-exported from schemas for convenience)
export type {
  Verdict,
  Step,
  Transition,
  Trigger,
  ProcessDefinition,
  ReviewConstraints,
  StepConfig,
  ProcessConfig,
  AuditEvent,
  StepInput,
  StepOutput,
  InstanceStatus,
  ProcessInstance,
  StepExecutionStatus,
  GateResult,
  ReviewVerdict,
  StepExecution,
  Annotation,
  AgentOutputEnvelope,
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
} from './schemas/index.js';

// Interfaces (repository and service contracts)
export type {
  AuditRepository,
  AuthService,
  AuthUser,
  ProcessRepository,
  ProcessInstanceRepository,
  GateErrorNotifier,
  GateErrorNotification,
  HumanTaskRepository,
  HandoffRepository,
  NotificationService,
  NotificationEvent,
  UserDirectoryService,
  DirectoryUser,
  AgentRunRepository,
} from './interfaces/index.js';

// Parser (YAML process definition parsing)
export { parseProcessDefinition, type ParseResult } from './parser/index.js';
export { formatZodErrors } from './parser/index.js';

// Testing utilities (in-memory implementations for test doubles)
export {
  InMemoryAuditRepository,
  InMemoryProcessRepository,
  InMemoryAuthService,
  InMemoryProcessInstanceRepository,
  NoOpGateErrorNotifier,
  InMemoryHumanTaskRepository,
  InMemoryHandoffRepository,
  NoopNotificationService,
  // Test factories
  buildProcessDefinition,
  buildProcessInstance,
  buildStepExecution,
  buildHumanTask,
  buildAgentRun,
  buildAuditEvent,
  buildProcessConfig,
  buildAgentOutputEnvelope,
  resetFactorySequence,
} from './testing/index.js';

// Validation
export { validateProcessConfig } from './validation/config-validator.js';
export type { ConfigValidationResult } from './validation/config-validator.js';

// Collaboration (handoff registry, RBAC)
export { handoffTypeRegistry, RbacService, RbacError } from './collaboration/index.js';
export type { HandoffTypeRegistration } from './collaboration/index.js';
