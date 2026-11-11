import { createRouteAdapter } from '@/lib/route-adapter';
import { listComparisons, prepareComparison } from '@mediforce/platform-api/handlers';
import { ListComparisonsInputSchema, PrepareComparisonInputSchema } from '@mediforce/platform-api/contract';

/** GET /api/evaluation/comparisons — The subject's Comparisons, newest first. */
export const GET = createRouteAdapter(
  ListComparisonsInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      namespace: params.get('namespace') ?? undefined,
      workflowName: params.get('workflowName') ?? undefined,
      stepId: params.get('stepId') ?? undefined,
      agentId: params.get('agentId') ?? undefined,
    };
  },
  listComparisons,
);

/** POST /api/evaluation/comparisons — Prepares a baseline and its Variants with one budget; nothing runs until it is started. */
export const POST = createRouteAdapter(
  PrepareComparisonInputSchema,
  async (req) => req.json().catch(() => ({})),
  prepareComparison,
  { successStatus: 201 },
);
