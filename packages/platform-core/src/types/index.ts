// Re-export all schema-inferred types for convenience.
// Consumers can import types from '@mediforce/platform-core' without
// knowing schema internals.

export type {
  Verdict,
  StepUi,
  StepParam,
  Selection,
  Step,
  StepType,
  Transition,
  Trigger,
  ProcessDefinition,
} from '../schemas/process-definition.js';

export type {
  ReviewConstraints,
  AgentConfig,
  StepConfig,
  ProcessConfig,
} from '../schemas/process-config.js';

export type { FileMetadata } from '../schemas/file-metadata.js';

export type { AuditEvent } from '../schemas/audit-event.js';

export type { StepInput, StepOutput } from '../schemas/step-contract.js';

export type {
  InstanceStatus,
  ProcessInstance,
} from '../schemas/process-instance.js';

export type {
  StepExecutionStatus,
  GateResult,
  ReviewVerdict,
  AgentOutputSnapshot,
  StepExecution,
} from '../schemas/step-execution.js';

export type {
  Annotation,
  GitMetadata,
  AgentOutputEnvelope,
} from '../schemas/agent-output-envelope.js';

export type { AgentEvent } from '../schemas/agent-event.js';

export type {
  AgentRunStatus,
  AgentRun,
} from '../schemas/agent-run.js';

export type {
  WorkflowAgentConfig,
  WorkflowCoworkConfig,
  WorkflowReviewConfig,
  WorkflowStep,
  WorkflowDefinition,
} from '../schemas/workflow-definition.js';

export type {
  ConversationTurn,
  CoworkSessionStatus,
  CoworkSession,
} from '../schemas/cowork-session.js';
