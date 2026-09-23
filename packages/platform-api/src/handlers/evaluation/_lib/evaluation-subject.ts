import type {
  AgentRun,
  EvaluatedStep,
  ProcessInstance,
  StoredAgentTrajectoryEntry,
} from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';
import { NotFoundError, ValidationError } from '../../../errors';

/** One Agent Run's output as an Evaluator sees it. */
export interface EvaluationSubject {
  readonly agentRun: AgentRun;
  readonly instance: ProcessInstance;
  /** What the step was given, from the execution the run belongs to. */
  readonly stepInput: Record<string, unknown> | null;
  readonly trajectory: StoredAgentTrajectoryEntry[];
}

/**
 * Loads an Agent Run for evaluation, gated through its parent Workflow Run —
 * `agentRuns.getById` is not workspace-gated (#588), so a run in another
 * workspace reads as missing here. With `step`, the run must belong to it.
 */
export async function loadEvaluationSubject(
  scope: CallerScope,
  agentRunId: string,
  step?: EvaluatedStep,
): Promise<EvaluationSubject> {
  const agentRun = await scope.agentRuns.getById(agentRunId);
  const instance = agentRun === null ? null : await scope.runs.getById(agentRun.processInstanceId);
  if (agentRun === null || instance === null) throw new NotFoundError(`Agent Run '${agentRunId}' not found`);
  if (step !== undefined && (
    (instance.namespace ?? '') !== step.namespace
    || instance.definitionName !== step.workflowName
    || agentRun.stepId !== step.stepId
  )) {
    throw new ValidationError(`Agent Run '${agentRunId}' is not a run of step '${step.stepId}' in '${step.workflowName}'`);
  }

  const executions = await scope.runs.getStepExecutions(instance.id);
  const execution = executions
    .filter((candidate) => candidate.stepId === agentRun.stepId && candidate.startedAt <= agentRun.startedAt)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
  const trajectory = await scope.agentTrajectories.list(agentRunId) ?? [];

  return {
    agentRun,
    instance,
    stepInput: (execution?.input as Record<string, unknown> | undefined) ?? null,
    trajectory,
  };
}
