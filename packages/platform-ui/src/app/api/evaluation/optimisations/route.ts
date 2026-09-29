import { createRouteAdapter } from '@/lib/route-adapter';
import { listOptimisations, startOptimisation } from '@mediforce/platform-api/handlers';
import { ListOptimisationsInputSchema, StartOptimisationInputSchema } from '@mediforce/platform-api/contract';

/** GET /api/evaluation/optimisations — The Step's GEPA optimisations, newest first. */
export const GET = createRouteAdapter(
  ListOptimisationsInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      namespace: params.get('namespace') ?? undefined,
      workflowName: params.get('workflowName') ?? undefined,
      stepId: params.get('stepId') ?? undefined,
    };
  },
  listOptimisations,
);

/** POST /api/evaluation/optimisations — Starts a GEPA optimisation under the budget the request grants. */
export const POST = createRouteAdapter(
  StartOptimisationInputSchema,
  async (req) => req.json().catch(() => ({})),
  startOptimisation,
  { successStatus: 201 },
);
