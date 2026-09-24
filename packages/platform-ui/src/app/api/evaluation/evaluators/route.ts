import { createRouteAdapter } from '@/lib/route-adapter';
import { createEvaluator, listEvaluators } from '@mediforce/platform-api/handlers';
import { CreateEvaluatorInputSchema, ListEvaluatorsInputSchema } from '@mediforce/platform-api/contract';

/** GET /api/evaluation/evaluators — The Step's Evaluators with their versions and trust (ADR-0023 D9). */
export const GET = createRouteAdapter(
  ListEvaluatorsInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      namespace: params.get('namespace') ?? undefined,
      workflowName: params.get('workflowName') ?? undefined,
      stepId: params.get('stepId') ?? undefined,
      includeArchived: params.get('includeArchived') ?? undefined,
    };
  },
  listEvaluators,
);

/** POST /api/evaluation/evaluators — Creates an Evaluator at version 1. */
export const POST = createRouteAdapter(
  CreateEvaluatorInputSchema,
  async (req) => req.json().catch(() => ({})),
  createEvaluator,
  { successStatus: 201 },
);
