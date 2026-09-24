import type { z } from 'zod';
import { createRouteAdapter } from '@/lib/route-adapter';
import { calibrateEvaluator } from '@mediforce/platform-api/handlers';
import { CalibrateEvaluatorInputSchema } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ evaluatorId: string }>;
}

/** POST /api/evaluation/evaluators/:evaluatorId/calibrate — Runs an `llm_judge` version over the labelled outputs and records its agreement. */
export const POST = createRouteAdapter<typeof CalibrateEvaluatorInputSchema, z.infer<typeof CalibrateEvaluatorInputSchema>, unknown, RouteContext>(
  CalibrateEvaluatorInputSchema,
  async (req, ctx) => ({
    ...((await req.json().catch(() => ({}))) as Record<string, unknown>),
    evaluatorId: (await ctx.params).evaluatorId,
  }),
  calibrateEvaluator,
);
