import { createRouteAdapter } from '@/lib/route-adapter';
import { listReviewedRunsForImport } from '@mediforce/platform-api/handlers';
import { ListReviewedRunsInputSchema } from '@mediforce/platform-api/contract';

/** GET /api/evaluation/reviewed-runs — A subject's reviewed production runs not yet an Eval Case. */
export const GET = createRouteAdapter(
  ListReviewedRunsInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      namespace: params.get('namespace') ?? undefined,
      workflowName: params.get('workflowName') ?? undefined,
      stepId: params.get('stepId') ?? undefined,
      agentId: params.get('agentId') ?? undefined,
      verdict: params.get('verdict') ?? undefined,
      definitionVersion: params.get('definitionVersion') ?? undefined,
      since: params.get('since') ?? undefined,
      until: params.get('until') ?? undefined,
    };
  },
  listReviewedRunsForImport,
);
