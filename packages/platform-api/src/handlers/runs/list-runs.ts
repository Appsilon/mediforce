import type { ProcessInstance } from '@mediforce/platform-core';
import type { ListRunsInput } from '../../contract/runs';
import { listAdapter } from '../_generic';

/**
 * List workflow runs (process instances) visible to the caller. Workspace
 * gating is enforced by the `scope.runs` wrapper — system actors see every
 * run, user callers see only runs whose namespace they're a member of.
 *
 * Returns the full `ProcessInstance` shape per Phase 4 PRD §9 (read-path
 * schema convergence with the detail endpoint).
 *
 * `parent` lists the runs one run spawned instead, oldest first.
 */
export const listRuns = listAdapter<ListRunsInput, ProcessInstance, 'runs'>(
  'runs',
  async (input, scope) => {
    if (input.parent !== undefined) {
      const children = await scope.runs.getChildren(input.parent);
      return children
        .filter((run) =>
          (input.workflow === undefined || run.definitionName === input.workflow)
          && (input.status === undefined || run.status === input.status)
          && (input.namespace === undefined || run.namespace === input.namespace)
          && (input.dryRun === undefined || run.dryRun === input.dryRun))
        .slice(0, input.limit);
    }
    return scope.runs.list({
      definitionName: input.workflow,
      status: input.status,
      namespace: input.namespace,
      limit: input.limit,
      dryRun: input.dryRun,
    });
  },
);
