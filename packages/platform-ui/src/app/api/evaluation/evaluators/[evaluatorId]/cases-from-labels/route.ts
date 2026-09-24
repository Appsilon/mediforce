import type { z } from 'zod';
import { createRouteAdapter } from '@/lib/route-adapter';
import { createEvalCasesFromLabels } from '@mediforce/platform-api/handlers';
import { CreateEvalCasesFromLabelsInputSchema } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ evaluatorId: string }>;
}

/** POST /api/evaluation/evaluators/:evaluatorId/cases-from-labels — Seeds Eval Cases from the Evaluator's labelled outputs. */
export const POST = createRouteAdapter<typeof CreateEvalCasesFromLabelsInputSchema, z.infer<typeof CreateEvalCasesFromLabelsInputSchema>, unknown, RouteContext>(
  CreateEvalCasesFromLabelsInputSchema,
  async (req, ctx) => ({
    ...((await req.json().catch(() => ({}))) as Record<string, unknown>),
    evaluatorId: (await ctx.params).evaluatorId,
  }),
  createEvalCasesFromLabels,
  { successStatus: 201 },
);
