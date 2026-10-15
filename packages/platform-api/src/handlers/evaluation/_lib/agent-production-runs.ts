import type { AgentRun, EvaluationSubject, ProcessInstance, WorkflowStep } from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';
import { listStepProductionAgentRuns } from './step-agent-runs';

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
}

/**
 * The Steps that use the Agent (ADR-0029: an Agent's production runs are
 * theirs), across every live version of the workflows of its workspace the
 * caller can see.
 */
async function findStepsUsingAgent(scope: CallerScope, agent: EvaluatedAgent): Promise<AgentStepUsage[]> {
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

/**
 * The newest finished production runs of the Steps using the Agent, at most
 * `limit`, newest first — each one `isProductionRunOfAgent` accepts, so every
 * run listed is one the assistant may read.
 */
export async function listAgentProductionRuns(
  scope: CallerScope,
  agent: EvaluatedAgent,
  limit: number,
): Promise<{ usages: AgentStepUsage[]; runs: AgentProductionRun[] }> {
  const usages = await findStepsUsingAgent(scope, agent);
  const perStep = await Promise.all(usages.map(async (usage) => {
    const runs = await listStepProductionAgentRuns(scope, { namespace: agent.namespace, workflowName: usage.workflowName, stepId: usage.stepId }, limit);
    const kept = await Promise.all(runs.map(async (agentRun) => {
      const instance = await scope.runs.getById(agentRun.processInstanceId);
      return instance !== null && await isProductionRunOfAgent(scope, agent, agentRun, instance) ? [{ usage, agentRun, instance }] : [];
    }));
    return kept.flat();
  }));
  const runs = perStep.flat()
    .sort((left, right) => right.agentRun.startedAt.localeCompare(left.agentRun.startedAt))
    .slice(0, limit);
  return { usages, runs };
}

/** Whether a run is a production run of a Step that used the Agent when it ran — not an eval trial, nor a dry run. */
export async function isProductionRunOfAgent(
  scope: CallerScope,
  agent: EvaluatedAgent,
  agentRun: AgentRun,
  instance: ProcessInstance,
): Promise<boolean> {
  if ((instance.namespace ?? '') !== agent.namespace || instance.evalRunId !== undefined || instance.dryRun === true) return false;
  const definition = await scope.workflowDefinitions.get(agent.namespace, instance.definitionName, Number(instance.definitionVersion));
  return definition?.steps.find((step) => step.id === agentRun.stepId)?.agentId === agent.agentId;
}
