import { createRouteAdapter } from '@/lib/route-adapter';
import { previewEvaluator } from '@mediforce/platform-api/handlers';
import { PreviewEvaluatorInputSchema } from '@mediforce/platform-api/contract';

/** POST /api/evaluation/evaluators/preview — Runs a draft check against existing outputs of the Step; writes nothing. */
export const POST = createRouteAdapter(
  PreviewEvaluatorInputSchema,
  async (req) => req.json().catch(() => ({})),
  previewEvaluator,
);
