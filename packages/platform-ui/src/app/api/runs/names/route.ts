import { createRouteAdapter } from '@/lib/route-adapter';
import { listRunNames } from '@mediforce/platform-api/handlers';
import {
  ListRunNamesInputSchema,
  type ListRunNamesInput,
} from '@mediforce/platform-api/contract';

/**
 * GET /api/runs/names?namespace=<handle>
 *
 * Projected `{ id, definitionName }` list for one workspace — backs the UI run
 * label map (issue #588). Workspace gating lives in
 * `scope.runs.listDefinitionNames`: api-key callers see every run in the
 * namespace, user callers see it only if they're a member.
 */
export const GET = createRouteAdapter<
  typeof ListRunNamesInputSchema,
  ListRunNamesInput
>(
  ListRunNamesInputSchema,
  (req) => ({
    namespace: req.nextUrl.searchParams.get('namespace') ?? undefined,
  }),
  listRunNames,
);
