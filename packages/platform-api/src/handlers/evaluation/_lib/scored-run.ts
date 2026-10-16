import {
  AGENT_EVAL_STEP_ID,
  type AgentRun,
  type EvaluationSubject,
  type ProcessInstance,
  type StoredAgentTrajectoryEntry,
} from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';
import { NotFoundError, ValidationError } from '../../../errors';
import type { EvaluationRef } from './evaluation-subject';

/** One Agent Run's output as an Evaluator sees it. */
export interface ScoredRun {
  readonly agentRun: AgentRun;
  readonly instance: ProcessInstance;
  /** What the step was given, from the execution the run belongs to. */
  readonly stepInput: Record<string, unknown> | null;
  readonly trajectory: StoredAgentTrajectoryEntry[];
}

/** Whether a run is one of an Agent's eval trials (ADR-0029): its carried single step names the Agent. */
export function isTrialOfAgent(agentRun: AgentRun, instance: ProcessInstance, agent: Extract<EvaluationSubject, { kind: 'agent' }>): boolean {
  return (instance.namespace ?? '') === agent.namespace
    && agentRun.stepId === AGENT_EVAL_STEP_ID
    && instance.evalDefinition?.steps[0]?.agentId === agent.agentId;
}

/**
 * The subject a run belongs to: the Agent an eval trial carries (ADR-0029),
 * else the Step of the Workflow it ran. A trial's `definitionName` is only a
 * label — workflow names are unrestricted, so it may name a real workflow.
 */
export function runSubjectRef(agentRun: AgentRun, instance: ProcessInstance): EvaluationRef {
  const namespace = instance.namespace ?? '';
  const trialAgentId = agentRun.stepId === AGENT_EVAL_STEP_ID ? instance.evalDefinition?.steps[0]?.agentId : undefined;
  return trialAgentId === undefined
    ? { namespace, workflowName: instance.definitionName, stepId: agentRun.stepId }
    : { namespace, agentId: trialAgentId };
}

/**
 * Loads an Agent Run gated through its parent Workflow Run —
 * `agentRuns.getById` is not workspace-gated (#588), so a run in another
 * workspace reads as missing here. With `subject`, the run must belong to it:
 * a run of the Step, or one of the Agent's eval trials.
 */
export async function loadGatedAgentRun(
  scope: CallerScope,
  agentRunId: string,
  subject?: EvaluationSubject,
): Promise<{ agentRun: AgentRun; instance: ProcessInstance }> {
  const agentRun = await scope.agentRuns.getById(agentRunId);
  const instance = agentRun === null ? null : await scope.runs.getById(agentRun.processInstanceId);
  if (agentRun === null || instance === null) throw new NotFoundError(`Agent Run '${agentRunId}' not found`);
  if (subject?.kind === 'agent' && isTrialOfAgent(agentRun, instance, subject) === false) {
    throw new ValidationError(`Agent Run '${agentRunId}' is not an eval trial of agent '${subject.agentId}'`);
  }
  if (subject?.kind === 'step' && (
    (instance.namespace ?? '') !== subject.namespace
    || instance.definitionName !== subject.workflowName
    || agentRun.stepId !== subject.stepId
  )) {
    throw new ValidationError(`Agent Run '${agentRunId}' is not a run of step '${subject.stepId}' in '${subject.workflowName}'`);
  }
  return { agentRun, instance };
}

/** What the step was given, from the execution the run belongs to. */
export async function loadStepInput(scope: CallerScope, agentRun: AgentRun, instance: ProcessInstance): Promise<Record<string, unknown> | null> {
  const executions = await scope.runs.getStepExecutions(instance.id);
  const execution = executions
    .filter((candidate) => candidate.stepId === agentRun.stepId && candidate.startedAt <= agentRun.startedAt)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
  return (execution?.input as Record<string, unknown> | undefined) ?? null;
}

/** Loads an Agent Run for evaluation, gated as `loadGatedAgentRun` is. */
export async function loadScoredRun(
  scope: CallerScope,
  agentRunId: string,
  subject?: EvaluationSubject,
): Promise<ScoredRun> {
  const { agentRun, instance } = await loadGatedAgentRun(scope, agentRunId, subject);
  return {
    agentRun,
    instance,
    stepInput: await loadStepInput(scope, agentRun, instance),
    trajectory: await scope.agentTrajectories.list(agentRunId) ?? [],
  };
}
