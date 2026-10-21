import {
  AGENT_EVAL_STEP_ID,
  agentEvalDefinition,
  describeEvaluationSubject,
  evaluationSubjectOf,
  inlineMcpServerNames,
  resolveRunnableVersion,
  type AgentDefinition,
  type EvaluationSubject,
  type WorkflowDefinition,
  type WorkflowStep,
} from '@mediforce/platform-core';
import { isLocalExecutionAllowed } from '@mediforce/agent-runtime';
import type { CallerScope } from '../../../repositories/index';
import { NotFoundError, ValidationError } from '../../../errors';
import { assertCallerMayEditWorkflow, assertCallerMayRunWorkflow } from '../../workflows/_access-gate';
import { upcomingAgentVersion } from '../../agents/_lib/agent-version';

/** What an Evaluation call or row names its subject by: a Step, an Agent, or a row owned by one. */
export interface EvaluationRef {
  readonly namespace: string;
  readonly workflowName?: string | null;
  readonly stepId?: string | null;
  readonly agentId?: string | null;
}

export interface LoadedSubject {
  readonly subject: EvaluationSubject;
  readonly definition: WorkflowDefinition;
  readonly step: WorkflowStep;
  /** The Agent an Agent's Evaluation is about (ADR-0029); null for a Step's. */
  readonly agent: AgentDefinition | null;
}

/** The subject `ref` names; a ValidationError when it names neither a Step nor an Agent, or both. */
export function subjectRef(ref: EvaluationRef): EvaluationSubject {
  const subject = evaluationSubjectOf(ref);
  if (subject === null) {
    throw new ValidationError('Name either a step (workflowName and stepId) or an agent (agentId) to evaluate, not both');
  }
  return subject;
}

/**
 * What an Evaluation call is about, with the caller's right to act on it
 * checked. A Step is loaded as it stands in the workflow's runnable version —
 * or, when that version no longer has the step, the newest live version that
 * does, since the step's Evaluation rows outlive it there — or in `version`,
 * when given (`'runnable'` pins the runnable version, for a call that builds a
 * new version from it). `read` needs only to see the workflow, `edit` and
 * `run` ask its Access rows (ADR-0019). `run` gates what executes on the
 * Step's behalf — check code, a paid judge. An invisible workflow reads as
 * missing, never as forbidden.
 *
 * An Agent (ADR-0029) comes back as the single-step Definition its trials run,
 * at Agent version `version` when given. `read` needs to see the Agent, `edit`
 * and `run` to be allowed to change it.
 */
export async function loadEvaluationSubject(
  scope: CallerScope,
  ref: EvaluationRef,
  verb: 'read' | 'edit' | 'run',
  version?: number | 'runnable',
  agentEnv?: Record<string, string>,
): Promise<LoadedSubject> {
  const subject = subjectRef(ref);
  if (subject.kind === 'agent') return loadEvaluatedAgent(scope, subject, verb, typeof version === 'number' ? version : undefined, agentEnv);

  const definition = typeof version === 'number'
    ? await scope.workflowDefinitions.get(subject.namespace, subject.workflowName, version)
    : await definitionHoldingStep(scope, subject, version === 'runnable');
  if (definition === null) {
    throw new NotFoundError(`Workflow '${subject.workflowName}' v${String(version)} not found`);
  }
  const step = definition.steps.find((candidate) => candidate.id === subject.stepId);
  if (step === undefined) {
    throw new NotFoundError(`Step '${subject.stepId}' not found in '${subject.workflowName}' v${definition.version}`);
  }
  if (step.executor !== 'agent') {
    throw new ValidationError(`Step '${subject.stepId}' is a ${step.executor} step; only agent steps are evaluated`);
  }
  const inlineServers = inlineMcpServerNames(step);
  if (inlineServers.length > 0) {
    throw new ValidationError(`Step '${subject.stepId}' ${inlineMcpReason(inlineServers)}`);
  }
  if (verb === 'edit') await assertCallerMayEditWorkflow(scope, subject.namespace, subject.workflowName);
  if (verb === 'run') await assertCallerMayRunWorkflow(scope, subject.namespace, subject.workflowName);
  return { subject, definition, step, agent: null };
}

/**
 * An Agent evaluated on its own (ADR-0029). It must belong to the workspace
 * the call names, since its Evaluation lives there, and be a container agent
 * with a runtime — a cowork agent has no single output to grade.
 */
async function loadEvaluatedAgent(
  scope: CallerScope,
  subject: Extract<EvaluationSubject, { kind: 'agent' }>,
  verb: 'read' | 'edit' | 'run',
  agentVersion: number | undefined,
  env: Record<string, string> | undefined,
): Promise<LoadedSubject> {
  const agent = verb === 'read'
    ? await scope.agentDefinitions.getById(subject.agentId)
    : await scope.agentDefinitions.getForUpdate(subject.agentId).catch((error: unknown) => {
      if (error instanceof NotFoundError) return null;
      throw error;
    });
  if (agent === null || agent.namespace !== subject.namespace) {
    throw new NotFoundError(`Agent '${subject.agentId}' not found in '${subject.namespace}'`);
  }
  if (agent.kind !== 'plugin') {
    throw new ValidationError(`Agent '${agent.name}' is a cowork agent; only container agents are evaluated`);
  }
  if (agent.runtimeId === undefined) {
    throw new ValidationError(`Agent '${agent.name}' names no runtime; set one before evaluating it`);
  }
  const version = agentVersion ?? await upcomingAgentVersion(scope, agent);
  const definition = agentEvalDefinition({ id: agent.id, name: agent.name, image: agent.image, namespace: agent.namespace, runtimeId: agent.runtimeId }, version, env, { localExecution: isLocalExecutionAllowed() });
  return { subject, definition, step: definition.steps[0]!, agent };
}

/** Why a step that declares MCP servers inline cannot be evaluated. */
export function inlineMcpReason(serverNames: readonly string[]): string {
  return `declares MCP servers inline (${serverNames.join(', ')}); move them onto its agent before evaluating it`;
}

/** The runnable version, or — unless `runnableOnly` — the newest live version holding the step when the runnable one lacks it. */
async function definitionHoldingStep(
  scope: CallerScope,
  ref: Extract<EvaluationSubject, { kind: 'step' }>,
  runnableOnly: boolean,
): Promise<WorkflowDefinition> {
  const resolution = await resolveRunnableVersion(scope.workflowDefinitions, ref.namespace, ref.workflowName);
  if (resolution.ok === false) throw new NotFoundError(`Workflow '${ref.workflowName}' not found`);
  const holds = (definition: WorkflowDefinition) => definition.steps.some((candidate) => candidate.id === ref.stepId);
  if (runnableOnly || holds(resolution.def)) return resolution.def;
  const [newestHolding] = (await scope.workflowDefinitions.listVersions(ref.namespace, ref.workflowName))
    .filter((definition) => definition.archived !== true && definition.deleted !== true && holds(definition))
    .sort((left, right) => right.version - left.version);
  return newestHolding ?? resolution.def;
}

/** The id of the step a subject's trials run: the Step's own, or an Agent's single step. */
export function trialStepId(row: Pick<EvaluationRef, 'stepId'>): string {
  return row.stepId ?? AGENT_EVAL_STEP_ID;
}

/** The audit entity id of a subject's Evaluation: `workflow/step`, or `agent:<id>`. */
export function subjectKey(subject: EvaluationSubject): string {
  return subject.kind === 'agent' ? `agent:${subject.agentId}` : `${subject.workflowName}/${subject.stepId}`;
}

/** A subject as messages name it, `describeEvaluationSubject` capitalised to open a sentence. */
export function subjectName(subject: EvaluationSubject, capital = true): string {
  const described = describeEvaluationSubject(subject);
  return capital ? described.charAt(0).toUpperCase() + described.slice(1) : described;
}

/** The version an Eval Run ran: the Definition version of a Step's, the Agent version of an Agent's. */
export function runVersionOf(run: { definitionVersion: number | null; agentVersion: number | null }): number | undefined {
  return run.definitionVersion ?? run.agentVersion ?? undefined;
}

/**
 * The Step a production-only feature is about — harvesting a run, a preview
 * against past outputs, drift, production Evaluators. An Agent evaluated on
 * its own has no production runs of its own (ADR-0029), so it is refused.
 */
export function stepOnly(subject: EvaluationSubject, feature: string): Extract<EvaluationSubject, { kind: 'step' }> {
  if (subject.kind === 'agent') {
    throw new ValidationError(`${feature} works on a workflow step's production runs; agent '${subject.agentId}' is evaluated on its own Eval Cases only`);
  }
  return subject;
}
