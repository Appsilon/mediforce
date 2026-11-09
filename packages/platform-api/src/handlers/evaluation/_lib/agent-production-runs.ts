import { isDeepStrictEqual } from 'node:util';
import {
  agentStepChanges,
  resolveStepParams,
  UnresolvedStepParamError,
  type AgentDefinition,
  type AgentRun,
  type EvalCaseInput,
  type EvaluationSubject,
  type ProcessInstance,
  type WorkflowDefinition,
  type WorkflowStep,
} from '@mediforce/platform-core';
import type { AgentRunChange } from '../../../contract/evaluation';
import type { CallerScope } from '../../../repositories/index';
import { NotFoundError, ValidationError } from '../../../errors';
import { loadFirstRound } from './case-source';
import { loadGatedAgentRun, loadStepInput } from './scored-run';
import { listStepProductionAgentRunsPage } from './step-agent-runs';

type EvaluatedAgent = Extract<EvaluationSubject, { kind: 'agent' }>;

/** One Step of a workflow in the Agent's workspace that names the Agent. */
export interface AgentStepUsage {
  readonly workflowName: string;
  readonly stepId: string;
  /** The versions of the workflow whose step names the Agent, newest first. */
  readonly versions: readonly number[];
  /** The step as the newest of those versions has it. */
  readonly step: WorkflowStep;
}

/** A finished production Agent Run of a Step that used the Agent when it ran. */
export interface AgentProductionRun {
  readonly usage: AgentStepUsage;
  readonly agentRun: AgentRun;
  readonly instance: ProcessInstance;
  readonly change: AgentRunChange;
}

/** A production run as the source of an Agent's Eval Case. */
export interface AgentRunSource {
  readonly agentRun: AgentRun;
  readonly instance: ProcessInstance;
  readonly stepInput: Record<string, unknown> | null;
  readonly change: AgentRunChange;
  /** What the Agent was given before any reviewer sent it back, as its case holds it. */
  readonly input: EvalCaseInput;
  /** What the run returned; null when it answered under another output schema than the Agent's. */
  readonly result: NonNullable<AgentRun['envelope']>['result'];
}

export const WITHHELD_OUTPUT_ERROR = 'This run\'s step declares another output schema than the agent, so its output cannot be an Eval Case\'s expected output. Keep its input and give no expected output, or write one that follows the agent\'s output schema.';

/** Whether `expectedOutput` is the output of a run whose output no case of the Agent may take. */
export function expectsWithheldOutput(source: Pick<AgentRunSource, 'agentRun' | 'change'>, expectedOutput: unknown): boolean {
  if (expectedOutput === undefined || expectedOutput === null) return false;
  return source.change.outputSchemaDiffers && isDeepStrictEqual(expectedOutput, source.agentRun.envelope?.result);
}

/**
 * The Steps that use the Agent (ADR-0029: an Agent's production runs are
 * theirs), across every live version of the workflows of its workspace the
 * caller can see.
 */
export async function findStepsUsingAgent(scope: CallerScope, agent: EvaluatedAgent): Promise<AgentStepUsage[]> {
  const usages: AgentStepUsage[] = [];
  for (const group of await scope.workflowDefinitions.listGroups(false)) {
    if (group.namespace !== agent.namespace) continue;
    const live = group.versions.filter((definition) => definition.deleted !== true).sort((left, right) => right.version - left.version);
    const stepIds = new Set(live.flatMap((definition) => definition.steps.filter((step) => step.agentId === agent.agentId).map((step) => step.id)));
    for (const stepId of stepIds) {
      const using = live.flatMap((definition) => {
        const step = definition.steps.find((candidate) => candidate.id === stepId && candidate.agentId === agent.agentId);
        return step === undefined ? [] : [{ version: definition.version, step }];
      });
      usages.push({ workflowName: group.name, stepId, versions: using.map(({ version }) => version), step: using[0]!.step });
    }
  }
  return usages;
}

/** The Step of the version a run ran that used the Agent; null for an eval trial, a dry run or a Step that ran another agent. */
async function stepUsingAgent(
  scope: CallerScope,
  agent: EvaluatedAgent,
  agentRun: AgentRun,
  instance: ProcessInstance,
): Promise<{ definition: WorkflowDefinition; step: WorkflowStep } | null> {
  if ((instance.namespace ?? '') !== agent.namespace || instance.evalRunId !== undefined || instance.dryRun === true) return null;
  const definition = await scope.workflowDefinitions.get(agent.namespace, instance.definitionName, Number(instance.definitionVersion));
  const step = definition?.steps.find((candidate) => candidate.id === agentRun.stepId);
  return definition === null || definition === undefined || step === undefined || step.agentId !== agent.agentId ? null : { definition, step };
}

/** What the Step of a run changes about the Agent (ADR-0029 D8), by the version the run ran. */
function agentChangeOf(agent: AgentDefinition, definition: WorkflowDefinition, step: WorkflowStep): AgentRunChange {
  const declared = step.agent?.outputSchema;
  return {
    workflowName: definition.name,
    stepId: step.id,
    definitionVersion: definition.version,
    changes: agentStepChanges(step, agent, definition),
    outputSchemaDiffers: declared !== undefined && isDeepStrictEqual(declared, agent.outputSchema) === false,
  };
}

/**
 * What the Agent was given in a run, as its case holds it (ADR-0029 D4): a
 * trial's trigger payload is the Agent's whole input, so the step's input goes
 * there as the step merged it — literal stepParams, overridden by the step's
 * input, overridden by its `${…}` mappings. A `steps` that holds no earlier
 * output gave the Agent nothing.
 */
function agentCaseInputOf(step: WorkflowStep, instance: ProcessInstance, stepInput: Record<string, unknown> | null): EvalCaseInput {
  const { steps, ...fields } = stepInput ?? instance.triggerPayload ?? {};
  const given = isDeepStrictEqual(steps, {}) || steps === undefined ? fields : { ...fields, steps };
  try {
    const { defaults, mappings } = resolveStepParams(step.stepParams ?? {}, instance);
    return { triggerPayload: { ...defaults, ...given, ...mappings }, previousStepOutputs: {} };
  } catch (error) {
    if (error instanceof UnresolvedStepParamError) return { triggerPayload: given, previousStepOutputs: {} };
    throw error;
  }
}

/**
 * The run as it stood when `at` began: each step's output is its newest one
 * finished by then, so a step re-run later does not reach an earlier round.
 */
async function instanceAsOf(scope: CallerScope, instance: ProcessInstance, at: string): Promise<ProcessInstance> {
  const variables = { ...instance.variables };
  const finished = (await scope.runs.getStepExecutions(instance.id))
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  for (const { stepId } of finished) delete variables[stepId];
  for (const { stepId, output, completedAt } of finished) {
    if (completedAt !== null && completedAt <= at && output !== null) variables[stepId] = output;
  }
  return { ...instance, variables };
}

async function loadAgentDefinition(scope: CallerScope, agent: EvaluatedAgent): Promise<AgentDefinition> {
  const definition = await scope.agentDefinitions.getById(agent.agentId);
  if (definition === null) throw new NotFoundError(`Agent '${agent.agentId}' not found in '${agent.namespace}'`);
  return definition;
}

/**
 * The finished production runs of the Steps using the Agent, newest first:
 * `limit` of them after skipping `offset`, each one `isProductionRunOfAgent`
 * accepts — so every run listed is one the assistant may read — with what its
 * Step changes about the Agent.
 */
export async function listAgentProductionRuns(
  scope: CallerScope,
  agent: EvaluatedAgent,
  limit: number,
  offset = 0,
): Promise<{ usages: AgentStepUsage[]; runs: AgentProductionRun[]; hasMore: boolean }> {
  const usages = await findStepsUsingAgent(scope, agent);
  if (usages.length === 0) return { usages, runs: [], hasMore: false };
  const definition = await loadAgentDefinition(scope, agent);
  let moreInStep = false;
  const perStep = await Promise.all(usages.map(async (usage) => {
    const page = await listStepProductionAgentRunsPage(scope, { namespace: agent.namespace, workflowName: usage.workflowName, stepId: usage.stepId }, offset + limit + 1);
    if (page.nextCursor !== undefined) moreInStep = true;
    const kept = await Promise.all(page.runs.map(async (agentRun) => {
      const instance = await scope.runs.getById(agentRun.processInstanceId);
      const using = instance === null ? null : await stepUsingAgent(scope, agent, agentRun, instance);
      return instance === null || using === null ? [] : [{ usage, agentRun, instance, change: agentChangeOf(definition, using.definition, using.step) }];
    }));
    return kept.flat();
  }));
  const newestFirst = perStep.flat().sort((left, right) => right.agentRun.startedAt.localeCompare(left.agentRun.startedAt));
  return { usages, runs: newestFirst.slice(offset, offset + limit), hasMore: moreInStep || newestFirst.length > offset + limit };
}

/** Whether a run is a production run of a Step that used the Agent when it ran — not an eval trial, nor a dry run. */
export async function isProductionRunOfAgent(
  scope: CallerScope,
  agent: EvaluatedAgent,
  agentRun: AgentRun,
  instance: ProcessInstance,
): Promise<boolean> {
  return await stepUsingAgent(scope, agent, agentRun, instance) !== null;
}

/** What the Step of a production run changes about the Agent; null when the run is not a production run of a Step that used it. */
export async function agentRunChange(
  scope: CallerScope,
  agent: EvaluatedAgent,
  agentRun: AgentRun,
  instance: ProcessInstance,
): Promise<AgentRunChange | null> {
  const using = await stepUsingAgent(scope, agent, agentRun, instance);
  return using === null ? null : agentChangeOf(await loadAgentDefinition(scope, agent), using.definition, using.step);
}

/** A production run of a Step that used the Agent, as the source of the Agent's Eval Case; any other run is refused. */
export async function loadAgentRunSource(scope: CallerScope, agent: EvaluatedAgent, agentRunId: string): Promise<AgentRunSource> {
  const { agentRun, instance } = await loadGatedAgentRun(scope, agentRunId);
  const using = await stepUsingAgent(scope, agent, agentRun, instance);
  if (using === null) throw new ValidationError(`Agent Run '${agentRunId}' is not a production run of a step that uses agent '${agent.agentId}'`);
  const change = agentChangeOf(await loadAgentDefinition(scope, agent), using.definition, using.step);
  const stepInput = await loadStepInput(scope, agentRun, instance);
  const firstRound = await loadFirstRound(scope, agentRun);
  return {
    agentRun,
    instance,
    stepInput,
    change,
    input: agentCaseInputOf(using.step, await instanceAsOf(scope, instance, firstRound.startedAt), await loadStepInput(scope, firstRound, instance)),
    result: change.outputSchemaDiffers ? null : agentRun.envelope?.result ?? null,
  };
}
