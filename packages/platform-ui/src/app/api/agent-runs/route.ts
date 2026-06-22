import { createRouteAdapter } from '@/lib/route-adapter';
import { listAgentRuns } from '@mediforce/platform-api/handlers';
import { ListAgentRunsInputSchema, type ListAgentRunsInput } from '@mediforce/platform-api/contract';

/**
 * GET /api/agent-runs
 *
 * Accepted query params:
 *   - `namespace` — narrow to a single workspace handle (intersected with
 *                    caller membership; out-of-scope handle → 403)
 *   - `runId`     — filter to one process instance
 *   - `stepId`    — filter to one step within `runId` (requires `runId`)
 *   - `limit`     — max items (1..200, default 50)
 *   - `cursor`    — opaque token from a prior `nextCursor`
 */
export const GET = createRouteAdapter<typeof ListAgentRunsInputSchema, ListAgentRunsInput>(
  ListAgentRunsInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      namespace: params.get('namespace') ?? undefined,
      runId: params.get('runId') ?? undefined,
      stepId: params.get('stepId') ?? undefined,
      limit: params.get('limit') ?? undefined,
      cursor: params.get('cursor') ?? undefined,
    };
  },
  listAgentRuns,
);
