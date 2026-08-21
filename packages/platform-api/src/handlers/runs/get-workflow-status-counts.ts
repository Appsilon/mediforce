import type {
  GetWorkflowStatusCountsInput,
  GetWorkflowStatusCountsOutput,
} from '../../contract/runs';
import type { CallerScope } from '../../repositories/index';

/**
 * Grouped `WorkflowDisplayStatus` counts for the Workflows tab's KPI cards —
 * computed in Postgres, not by fetching every run and tallying in JS. See
 * `GetWorkflowStatusCountsInputSchema`'s docstring: same filters as the runs
 * table (minus `displayStatus` itself and pagination), so a KPI card's
 * number always matches what clicking it would filter the table to.
 */
export async function getWorkflowStatusCounts(
  input: GetWorkflowStatusCountsInput,
  scope: CallerScope,
): Promise<GetWorkflowStatusCountsOutput> {
  const counts = await scope.runs.countByDisplayStatus({
    definitionName: input.workflow,
    namespace: input.namespace,
    dryRun: input.dryRun,
    archived: input.archived,
  });
  return { counts };
}
