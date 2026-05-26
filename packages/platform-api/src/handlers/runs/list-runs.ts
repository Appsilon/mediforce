import type { ProcessInstance } from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index.js';
import type { ListRunsInput, ListRunsOutput } from '../../contract/runs.js';
import { listAdapter } from '../_generic.js';

function toWireRun(inst: ProcessInstance): ListRunsOutput['runs'][number] {
  return {
    runId: inst.id,
    status: inst.status,
    definitionName: inst.definitionName,
    definitionVersion: inst.definitionVersion,
    currentStepId: inst.currentStepId,
    error: inst.error,
    createdAt: inst.createdAt,
    updatedAt: inst.updatedAt,
    createdBy: inst.createdBy,
    ...(inst.totalCostUsd != null ? { totalCostUsd: inst.totalCostUsd } : {}),
  };
}

/**
 * List workflow runs (process instances) visible to the caller. Workspace
 * gating is enforced by the `scope.runs` wrapper — system actors see every
 * run, user callers see only runs whose namespace they're a member of.
 */
export const listRuns = listAdapter<ListRunsInput, ListRunsOutput['runs'][number], 'runs'>(
  'runs',
  async (input, scope) => {
    const runs = await scope.runs.list({
      definitionName: input.workflow,
      status: input.status,
      limit: input.limit,
    });
    return runs.map(toWireRun);
  },
);
