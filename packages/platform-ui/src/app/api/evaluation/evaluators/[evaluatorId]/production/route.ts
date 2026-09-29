import type { z } from 'zod';
import { createRouteAdapter } from '@/lib/route-adapter';
import { setEvaluatorProduction } from '@mediforce/platform-api/handlers';
import { SetEvaluatorProductionInputSchema } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ evaluatorId: string }>;
}

/** POST /api/evaluation/evaluators/:evaluatorId/production — Sets whether an Evaluator also scores live production Agent Runs. */
export const POST = createRouteAdapter<typeof SetEvaluatorProductionInputSchema, z.infer<typeof SetEvaluatorProductionInputSchema>, unknown, RouteContext>(
  SetEvaluatorProductionInputSchema,
  async (req, ctx) => ({
    ...((await req.json().catch(() => ({}))) as Record<string, unknown>),
    evaluatorId: (await ctx.params).evaluatorId,
  }),
  setEvaluatorProduction,
);
