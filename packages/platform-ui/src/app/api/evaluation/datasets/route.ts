import { createRouteAdapter } from '@/lib/route-adapter';
import { saveEvalDataset, listEvalDatasets } from '@mediforce/platform-api/handlers';
import { SaveEvalDatasetInputSchema, ListEvalDatasetsInputSchema } from '@mediforce/platform-api/contract';

/** GET /api/evaluation/datasets — The Step's saved Eval Dataset versions, newest first. */
export const GET = createRouteAdapter(
  ListEvalDatasetsInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      namespace: params.get('namespace') ?? undefined,
      workflowName: params.get('workflowName') ?? undefined,
      stepId: params.get('stepId') ?? undefined,
      agentId: params.get('agentId') ?? undefined,
    };
  },
  listEvalDatasets,
);

/** POST /api/evaluation/datasets — Saves the Step's live Eval Cases (or the named ones) as a new Dataset version. */
export const POST = createRouteAdapter(
  SaveEvalDatasetInputSchema,
  async (req) => req.json().catch(() => ({})),
  saveEvalDataset,
  { successStatus: 201 },
);
