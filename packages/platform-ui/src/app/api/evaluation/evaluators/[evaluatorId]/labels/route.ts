import type { z } from 'zod';
import { createRouteAdapter } from '@/lib/route-adapter';
import { labelEvaluatorOutput, listEvaluatorLabels } from '@mediforce/platform-api/handlers';
import { LabelEvaluatorOutputInputSchema, ListEvaluatorLabelsInputSchema } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ evaluatorId: string }>;
}

/** POST /api/evaluation/evaluators/:evaluatorId/labels — Records a human pass/fail label on one Agent Run's output, as a Score. */
export const POST = createRouteAdapter<typeof LabelEvaluatorOutputInputSchema, z.infer<typeof LabelEvaluatorOutputInputSchema>, unknown, RouteContext>(
  LabelEvaluatorOutputInputSchema,
  async (req, ctx) => ({
    ...((await req.json().catch(() => ({}))) as Record<string, unknown>),
    evaluatorId: (await ctx.params).evaluatorId,
  }),
  labelEvaluatorOutput,
  { successStatus: 201 },
);

/** GET /api/evaluation/evaluators/:evaluatorId/labels — The newest human label per Agent Run, newest first. */
export const GET = createRouteAdapter<typeof ListEvaluatorLabelsInputSchema, z.infer<typeof ListEvaluatorLabelsInputSchema>, unknown, RouteContext>(
  ListEvaluatorLabelsInputSchema,
  async (_req, ctx) => ({ evaluatorId: (await ctx.params).evaluatorId }),
  listEvaluatorLabels,
);
