import type { z } from 'zod';
import { createRouteAdapter } from '@/lib/route-adapter';
import { startComparison } from '@mediforce/platform-api/handlers';
import { StartComparisonInputSchema } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ comparisonId: string }>;
}

/** POST /api/evaluation/comparisons/:comparisonId/start — Starts its runs; `confirmedBudgetUsd` must equal its budget. */
export const POST = createRouteAdapter<typeof StartComparisonInputSchema, z.infer<typeof StartComparisonInputSchema>, unknown, RouteContext>(
  StartComparisonInputSchema,
  async (req, ctx) => ({
    ...((await req.json().catch(() => ({}))) as Record<string, unknown>),
    comparisonId: (await ctx.params).comparisonId,
  }),
  startComparison,
);
