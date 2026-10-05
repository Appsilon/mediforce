import type { z } from 'zod';
import { createRouteAdapter } from '@/lib/route-adapter';
import { getEvalRunFailures } from '@mediforce/platform-api/handlers';
import { GetEvalRunFailuresInputSchema } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ evalRunId: string }>;
}

/** GET /api/evaluation/runs/:evalRunId/failures — The run's failing trials, with their cases and the Evaluators that failed. */
export const GET = createRouteAdapter<typeof GetEvalRunFailuresInputSchema, z.infer<typeof GetEvalRunFailuresInputSchema>, unknown, RouteContext>(
  GetEvalRunFailuresInputSchema,
  async (req, ctx) => ({
    evalRunId: (await ctx.params).evalRunId,
    limit: req.nextUrl.searchParams.get('limit') ?? undefined,
  }),
  getEvalRunFailures,
);
