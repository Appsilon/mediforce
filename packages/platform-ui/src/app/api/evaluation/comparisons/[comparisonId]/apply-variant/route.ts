import type { z } from 'zod';
import { createRouteAdapter } from '@/lib/route-adapter';
import { applyVariant } from '@mediforce/platform-api/handlers';
import { ApplyVariantInputSchema } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ comparisonId: string }>;
}

/** POST /api/evaluation/comparisons/:comparisonId/apply-variant — Applies a Comparison's winning Variant for real. */
export const POST = createRouteAdapter<typeof ApplyVariantInputSchema, z.infer<typeof ApplyVariantInputSchema>, unknown, RouteContext>(
  ApplyVariantInputSchema,
  async (req, ctx) => ({
    ...((await req.json().catch(() => ({}))) as Record<string, unknown>),
    comparisonId: (await ctx.params).comparisonId,
  }),
  applyVariant,
);
