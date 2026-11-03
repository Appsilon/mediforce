import type { AgentRun, EvaluatedStep } from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';

export interface StepProductionAgentRunsPage {
  readonly runs: AgentRun[];
  /** Where the next page starts; absent on the last one. */
  readonly nextCursor?: string;
}

/**
 * A page of the Step's finished production Agent Runs, newest first. Running
 * rows are skipped by fetching again rather than over-fetching and trimming,
 * so the cursor never passes a run the page did not return. With `keep`, so
 * are the finished runs it turns down.
 */
export async function listStepProductionAgentRunsPage(
  scope: CallerScope,
  step: EvaluatedStep,
  limit: number,
  cursor?: string,
  keep: (run: AgentRun) => boolean = () => true,
): Promise<StepProductionAgentRunsPage> {
  const instanceIds = await scope.runs.getIdsByDefinitionName(step.namespace, step.workflowName, { excludeDryRuns: true });
  if (instanceIds.length === 0) return { runs: [] };
  const runs: AgentRun[] = [];
  let nextCursor = cursor;
  do {
    const page = await scope.agentRuns.listPage({
      limit: limit - runs.length,
      cursor: nextCursor,
      stepId: step.stepId,
      namespace: step.namespace,
      processInstanceIds: instanceIds,
    });
    runs.push(...page.items.filter((run) => run.status !== 'running' && keep(run)));
    nextCursor = page.nextCursor;
  } while (runs.length < limit && nextCursor !== undefined);
  return nextCursor === undefined ? { runs } : { runs, nextCursor };
}

/** The Step's latest finished production Agent Runs that `keep` takes, newest first. */
export async function listStepProductionAgentRuns(
  scope: CallerScope,
  step: EvaluatedStep,
  limit: number,
  keep?: (run: AgentRun) => boolean,
): Promise<AgentRun[]> {
  return (await listStepProductionAgentRunsPage(scope, step, limit, undefined, keep)).runs;
}
