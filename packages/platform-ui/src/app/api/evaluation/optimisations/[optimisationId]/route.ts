import type { z } from 'zod';
import { createRouteAdapter } from '@/lib/route-adapter';
import { getOptimisation } from '@mediforce/platform-api/handlers';
import { GetOptimisationInputSchema } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ optimisationId: string }>;
}

/** GET /api/evaluation/optimisations/:optimisationId — The optimisation and its candidates, ranked. */
export const GET = createRouteAdapter<typeof GetOptimisationInputSchema, z.infer<typeof GetOptimisationInputSchema>, unknown, RouteContext>(
  GetOptimisationInputSchema,
  async (_req, ctx) => ({ optimisationId: (await ctx.params).optimisationId }),
  getOptimisation,
);
