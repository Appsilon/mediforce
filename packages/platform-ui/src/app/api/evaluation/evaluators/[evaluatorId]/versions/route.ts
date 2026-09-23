import type { z } from 'zod';
import { createRouteAdapter } from '@/lib/route-adapter';
import { addEvaluatorVersion } from '@mediforce/platform-api/handlers';
import { AddEvaluatorVersionInputSchema } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ evaluatorId: string }>;
}

/** POST /api/evaluation/evaluators/:evaluatorId/versions — Adds an immutable version (ADR-0023 D7). */
export const POST = createRouteAdapter<typeof AddEvaluatorVersionInputSchema, z.infer<typeof AddEvaluatorVersionInputSchema>, unknown, RouteContext>(
  AddEvaluatorVersionInputSchema,
  async (req, ctx) => ({
    ...((await req.json().catch(() => ({}))) as Record<string, unknown>),
    evaluatorId: (await ctx.params).evaluatorId,
  }),
  addEvaluatorVersion,
  { successStatus: 201 },
);
