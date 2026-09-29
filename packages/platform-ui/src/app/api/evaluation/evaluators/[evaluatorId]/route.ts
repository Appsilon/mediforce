import type { z } from 'zod';
import { createRouteAdapter } from '@/lib/route-adapter';
import { getEvaluator } from '@mediforce/platform-api/handlers';
import { GetEvaluatorInputSchema } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ evaluatorId: string }>;
}

/** GET /api/evaluation/evaluators/:evaluatorId — One Evaluator with its versions and trust. */
export const GET = createRouteAdapter<typeof GetEvaluatorInputSchema, z.infer<typeof GetEvaluatorInputSchema>, unknown, RouteContext>(
  GetEvaluatorInputSchema,
  async (_req, ctx) => ({ evaluatorId: (await ctx.params).evaluatorId }),
  getEvaluator,
);
