import type { z } from 'zod';
import { createRouteAdapter } from '@/lib/route-adapter';
import { cancelComparison } from '@mediforce/platform-api/handlers';
import { CancelComparisonInputSchema } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ comparisonId: string }>;
}

/** POST /api/evaluation/comparisons/:comparisonId/cancel — Stops the Comparison and every run it prepared that has not finished. */
export const POST = createRouteAdapter<typeof CancelComparisonInputSchema, z.infer<typeof CancelComparisonInputSchema>, unknown, RouteContext>(
  CancelComparisonInputSchema,
  async (_req, ctx) => ({ comparisonId: (await ctx.params).comparisonId }),
  cancelComparison,
);
