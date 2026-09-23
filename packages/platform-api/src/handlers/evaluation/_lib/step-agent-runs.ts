import type { AgentRun, EvaluatedStep } from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';

/** The Step's finished production Agent Runs, newest first. */
export async function listStepProductionAgentRuns(
  scope: CallerScope,
  step: EvaluatedStep,
  limit: number,
): Promise<AgentRun[]> {
  const instanceIds = await scope.runs.getIdsByDefinitionName(step.namespace, step.workflowName, { excludeDryRuns: true });
  if (instanceIds.length === 0) return [];
  // Over-fetch: running rows are dropped below and a page is at most 50.
  const page = await scope.agentRuns.listPage({
    limit: Math.min(limit * 2, 100),
    stepId: step.stepId,
    namespace: step.namespace,
    processInstanceIds: instanceIds,
  });
  return page.items.filter((run) => run.status !== 'running').slice(0, limit);
}
