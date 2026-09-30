import { createRouteAdapter } from '@/lib/route-adapter';
import { createWrittenOutput, listWrittenOutputs } from '@mediforce/platform-api/handlers';
import { CreateWrittenOutputInputSchema, ListWrittenOutputsInputSchema } from '@mediforce/platform-api/contract';

/** GET /api/evaluation/written-outputs — The Step's written outputs, newest first. */
export const GET = createRouteAdapter(
  ListWrittenOutputsInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      namespace: params.get('namespace') ?? undefined,
      workflowName: params.get('workflowName') ?? undefined,
      stepId: params.get('stepId') ?? undefined,
      includeArchived: params.get('includeArchived') ?? undefined,
    };
  },
  listWrittenOutputs,
);

/** POST /api/evaluation/written-outputs — Adds a written output, labelled for a judge when `label` is given. */
export const POST = createRouteAdapter(
  CreateWrittenOutputInputSchema,
  async (req) => req.json().catch(() => ({})),
  createWrittenOutput,
  { successStatus: 201 },
);
