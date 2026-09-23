import { createRouteAdapter } from '@/lib/route-adapter';
import { freezeEvalDataset, listEvalDatasets } from '@mediforce/platform-api/handlers';
import { FreezeEvalDatasetInputSchema, ListEvalDatasetsInputSchema } from '@mediforce/platform-api/contract';

/** GET /api/evaluation/datasets — The Step's frozen Eval Dataset versions, newest first. */
export const GET = createRouteAdapter(
  ListEvalDatasetsInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      namespace: params.get('namespace') ?? undefined,
      workflowName: params.get('workflowName') ?? undefined,
      stepId: params.get('stepId') ?? undefined,
    };
  },
  listEvalDatasets,
);

/** POST /api/evaluation/datasets — Freezes the Step's live Eval Cases (or the named ones) as a new Dataset version. */
export const POST = createRouteAdapter(
  FreezeEvalDatasetInputSchema,
  async (req) => req.json().catch(() => ({})),
  freezeEvalDataset,
  { successStatus: 201 },
);
