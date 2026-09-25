import { createRouteAdapter } from '@/lib/route-adapter';
import { getStepDrift } from '@mediforce/platform-api/handlers';
import { GetStepDriftInputSchema } from '@mediforce/platform-api/contract';

/**
 * GET /api/evaluation/drift — Drift alerts for the Step: per production
 * Evaluator, the rolling mean of its production Scores against the window
 * before. `window` and `threshold` override the deployment's settings.
 */
export const GET = createRouteAdapter(
  GetStepDriftInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      namespace: params.get('namespace') ?? undefined,
      workflowName: params.get('workflowName') ?? undefined,
      stepId: params.get('stepId') ?? undefined,
      window: params.get('window') ?? undefined,
      threshold: params.get('threshold') ?? undefined,
    };
  },
  getStepDrift,
);
