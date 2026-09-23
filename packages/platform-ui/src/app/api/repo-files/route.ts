import { createRouteAdapter } from '@/lib/route-adapter';
import { browseDraftRepo } from '@mediforce/platform-api/handlers';
import {
  BrowseDraftRepoInputSchema,
  type BrowseDraftRepoInput,
} from '@mediforce/platform-api/contract';

/**
 * GET /api/repo-files — browse a repository named directly, for a workflow
 * being drafted and not yet saved. Read-only, and carries no workflow secret:
 * see `browseDraftRepo`.
 */
export const GET = createRouteAdapter<
  typeof BrowseDraftRepoInputSchema,
  BrowseDraftRepoInput,
  unknown
>(
  BrowseDraftRepoInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    const input: Record<string, unknown> = {
      namespace: params.get('namespace') ?? '',
      repo: params.get('repo') ?? '',
      commit: params.get('commit') ?? '',
    };
    const path = params.get('path');
    if (path !== null) input.path = path;
    return input;
  },
  browseDraftRepo,
);
