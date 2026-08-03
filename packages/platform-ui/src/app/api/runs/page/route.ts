import { createRouteAdapter } from '@/lib/route-adapter';
import { listRunsPage } from '@mediforce/platform-api/handlers';
import {
  ListRunsPageInputSchema,
  type ListRunsPageInput,
} from '@mediforce/platform-api/contract';

/**
 * GET /api/runs/page
 *
 * Keyset-paginated, newest-first workflow runs — see
 * `ListRunsPageInputSchema`'s docstring for why this is separate from
 * `GET /api/runs`. Workspace gating lives in `scope.runs.listPage`.
 */
export const GET = createRouteAdapter<typeof ListRunsPageInputSchema, ListRunsPageInput>(
  ListRunsPageInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      workflow: params.get('workflow') ?? undefined,
      namespace: params.get('namespace') ?? undefined,
      dryRun: params.get('dryRun') ?? undefined,
      archived: params.get('archived') ?? undefined,
      displayStatus: params.get('displayStatus') ?? undefined,
      cursor: params.get('cursor') ?? undefined,
      limit: params.get('limit') ?? undefined,
    };
  },
  listRunsPage,
);
