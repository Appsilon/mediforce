import { createRouteAdapter } from '@/lib/route-adapter';
import { estimateEvalRunCost } from '@mediforce/platform-api/handlers';
import { EstimateEvalRunInputSchema } from '@mediforce/platform-api/contract';

/** POST /api/evaluation/runs/estimate — What an Eval Run would cost and the budget cap it would get; creates nothing. */
export const POST = createRouteAdapter(
  EstimateEvalRunInputSchema,
  async (req) => req.json().catch(() => ({})),
  estimateEvalRunCost,
);
