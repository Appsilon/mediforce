import type { z } from 'zod';
import { createRouteAdapter } from '@/lib/route-adapter';
import { startEvalRun } from '@mediforce/platform-api/handlers';
import { StartEvalRunInputSchema } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ evalRunId: string }>;
}

/** POST /api/evaluation/runs/:evalRunId/start — Starts a prepared Eval Run; `confirmedBudgetUsd` must equal its budget. */
export const POST = createRouteAdapter<typeof StartEvalRunInputSchema, z.infer<typeof StartEvalRunInputSchema>, unknown, RouteContext>(
  StartEvalRunInputSchema,
  async (req, ctx) => ({
    ...((await req.json().catch(() => ({}))) as Record<string, unknown>),
    evalRunId: (await ctx.params).evalRunId,
  }),
  startEvalRun,
);
