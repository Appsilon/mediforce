import { createRouteAdapter } from '@/lib/route-adapter';
import { getWorkflowStatusCounts } from '@mediforce/platform-api/handlers';
import {
  GetWorkflowStatusCountsInputSchema,
  type GetWorkflowStatusCountsInput,
} from '@mediforce/platform-api/contract';

/**
 * GET /api/runs/status-counts
 *
 * Grouped `WorkflowDisplayStatus` counts for the Workflows tab's KPI cards —
 * see `GetWorkflowStatusCountsInputSchema`'s docstring. Workspace gating
 * lives in `scope.runs.countByDisplayStatus`.
 */
export const GET = createRouteAdapter<
  typeof GetWorkflowStatusCountsInputSchema,
  GetWorkflowStatusCountsInput
>(
  GetWorkflowStatusCountsInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      workflow: params.get('workflow') ?? undefined,
      namespace: params.get('namespace') ?? undefined,
      dryRun: params.get('dryRun') ?? undefined,
      archived: params.get('archived') ?? undefined,
    };
  },
  getWorkflowStatusCounts,
);
