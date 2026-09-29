import type { z } from 'zod';
import { createRouteAdapter } from '@/lib/route-adapter';
import { approveEvaluatorSource } from '@mediforce/platform-api/handlers';
import { ApproveEvaluatorSourceInputSchema } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ evaluatorId: string }>;
}

/** POST /api/evaluation/evaluators/:evaluatorId/approve — Records a person's approval of a `code` version's source (ADR-0023 D9). */
export const POST = createRouteAdapter<typeof ApproveEvaluatorSourceInputSchema, z.infer<typeof ApproveEvaluatorSourceInputSchema>, unknown, RouteContext>(
  ApproveEvaluatorSourceInputSchema,
  async (req, ctx) => ({
    ...((await req.json().catch(() => ({}))) as Record<string, unknown>),
    evaluatorId: (await ctx.params).evaluatorId,
  }),
  approveEvaluatorSource,
);
