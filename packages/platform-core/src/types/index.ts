// Re-export all schema-inferred types for convenience.
// Consumers can import types from '@mediforce/platform-core' without
// knowing schema internals.

export type {
  Verdict,
  StepUi,
  StepParam,
  Selection,
  Step,
  Transition,
  Trigger,
  ProcessDefinition,
} from '../schemas/process-definition';

export type {
  ReviewConstraints,
  AgentConfig,
  StepConfig,
  ProcessConfig,
} from '../schemas/process-config';

export type { FileMetadata } from '../schemas/file-metadata';

export type { AuditEvent } from '../schemas/audit-event';

export type { StepInput, StepOutput } from '../schemas/step-contract';

export type {
  InstanceStatus,
  ProcessInstance,
} from '../schemas/process-instance';

export type {
  StepExecutionStatus,
  GateResult,
  ReviewVerdict,
  AgentOutputSnapshot,
  StepExecution,
} from '../schemas/step-execution';

export type {
  Annotation,
  GitMetadata,
  TokenUsage,
  Presentation,
  AgentOutputEnvelope,
} from '../schemas/agent-output-envelope';

export type { AgentEvent } from '../schemas/agent-event';

export type {
  AgentRunStatus,
  AgentRun,
} from '../schemas/agent-run';

export type {
  WorkflowAgentConfig,
  WorkflowCoworkConfig,
  WorkflowReviewConfig,
  WorkflowStep,
  WorkflowDefinition,
} from '../schemas/workflow-definition';

export type {
  ConversationTurn,
  CoworkSessionStatus,
  CoworkSession,
} from '../schemas/cowork-session';
