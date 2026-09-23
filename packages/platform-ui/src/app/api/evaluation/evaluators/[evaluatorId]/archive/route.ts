import type { z } from 'zod';
import { createRouteAdapter } from '@/lib/route-adapter';
import { archiveEvaluator } from '@mediforce/platform-api/handlers';
import { ArchiveEvaluatorInputSchema } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ evaluatorId: string }>;
}

/** POST /api/evaluation/evaluators/:evaluatorId/archive — Archives (or, with `archived: false`, restores) an Evaluator. */
export const POST = createRouteAdapter<typeof ArchiveEvaluatorInputSchema, z.infer<typeof ArchiveEvaluatorInputSchema>, unknown, RouteContext>(
  ArchiveEvaluatorInputSchema,
  async (req, ctx) => ({
    ...((await req.json().catch(() => ({}))) as Record<string, unknown>),
    evaluatorId: (await ctx.params).evaluatorId,
  }),
  archiveEvaluator,
);
