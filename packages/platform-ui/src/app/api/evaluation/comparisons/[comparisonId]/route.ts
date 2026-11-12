import type { z } from 'zod';
import { createRouteAdapter } from '@/lib/route-adapter';
import { getComparison } from '@mediforce/platform-api/handlers';
import { GetComparisonInputSchema } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ comparisonId: string }>;
}

/** GET /api/evaluation/comparisons/:comparisonId — The Comparison, each run, and each Variant against the baseline. */
export const GET = createRouteAdapter<typeof GetComparisonInputSchema, z.infer<typeof GetComparisonInputSchema>, unknown, RouteContext>(
  GetComparisonInputSchema,
  async (_req, ctx) => ({ comparisonId: (await ctx.params).comparisonId }),
  getComparison,
);
