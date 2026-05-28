import { createRouteAdapter } from '@/lib/route-adapter';
import { listRuns } from '@mediforce/platform-api/handlers';
import {
  ListRunsInputSchema,
  type ListRunsInput,
} from '@mediforce/platform-api/contract';

/**
 * GET /api/runs
 *
 * Lists workflow runs visible to the caller. Workspace gating lives in
 * `scope.runs.list` — api-key callers see every run, user callers see only
 * runs in workspaces they're a member of.
 */
export const GET = createRouteAdapter<typeof ListRunsInputSchema, ListRunsInput>(
  ListRunsInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      workflow: params.get('workflow') ?? undefined,
      status: params.get('status') ?? undefined,
      namespace: params.get('namespace') ?? undefined,
      limit: params.get('limit') ?? undefined,
    };
  },
  listRuns,
);
