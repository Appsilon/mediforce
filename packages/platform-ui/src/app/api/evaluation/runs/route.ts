import { createRouteAdapter } from '@/lib/route-adapter';
import { listEvalRuns, prepareEvalRun } from '@mediforce/platform-api/handlers';
import { ListEvalRunsInputSchema, PrepareEvalRunInputSchema } from '@mediforce/platform-api/contract';

/** GET /api/evaluation/runs — The Step's Eval Runs, newest first. */
export const GET = createRouteAdapter(
  ListEvalRunsInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      namespace: params.get('namespace') ?? undefined,
      workflowName: params.get('workflowName') ?? undefined,
      stepId: params.get('stepId') ?? undefined,
    };
  },
  listEvalRuns,
);

/** POST /api/evaluation/runs — Prepares an Eval Run with its cost estimate; nothing runs until it is started. */
export const POST = createRouteAdapter(
  PrepareEvalRunInputSchema,
  async (req) => req.json().catch(() => ({})),
  prepareEvalRun,
  { successStatus: 201 },
);
