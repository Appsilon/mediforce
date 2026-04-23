import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter } from '@/lib/route-adapter';
import { getCoworkSession } from '@mediforce/platform-api/handlers';
import { GetCoworkSessionInputSchema } from '@mediforce/platform-api/contract';
import type { GetCoworkSessionInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

/**
 * GET /api/cowork/:sessionId
 *
 * Returns the cowork session including conversation history and current
 * artifact. Missing sessions surface as 404 via `NotFoundError`.
 */
export const GET = createRouteAdapter<
  typeof GetCoworkSessionInputSchema,
  GetCoworkSessionInput,
  RouteContext
>(
  GetCoworkSessionInputSchema,
  async (_req, ctx) => ({ sessionId: (await ctx.params).sessionId }),
  (input) =>
    getCoworkSession(input, {
      coworkSessionRepo: getPlatformServices().coworkSessionRepo,
    }),
);
