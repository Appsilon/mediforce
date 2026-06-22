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
 */
export const listRuns = listAdapter<ListRunsInput, ProcessInstance, 'runs'>('runs', async (input, scope) =>
  scope.runs.list({
    definitionName: input.workflow,
    status: input.status,
    namespace: input.namespace,
    limit: input.limit,
    dryRun: input.dryRun,
  }),
);
