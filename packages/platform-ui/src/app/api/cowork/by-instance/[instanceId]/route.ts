import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter } from '@/lib/route-adapter';
import { getCoworkSessionByInstance } from '@mediforce/platform-api/handlers';
import { GetCoworkSessionByInstanceInputSchema } from '@mediforce/platform-api/contract';
import type { GetCoworkSessionByInstanceInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ instanceId: string }>;
}

/**
 * GET /api/cowork/by-instance/:instanceId
 *
 * Returns the most recent *active* cowork session for a given process
 * instance. Missing (no active session) surfaces as 404 via `NotFoundError`.
 */
export const GET = createRouteAdapter<
  typeof GetCoworkSessionByInstanceInputSchema,
  GetCoworkSessionByInstanceInput,
  RouteContext
>(
  GetCoworkSessionByInstanceInputSchema,
  async (_req, ctx) => ({ instanceId: (await ctx.params).instanceId }),
  (input) =>
    getCoworkSessionByInstance(input, {
      coworkSessionRepo: getPlatformServices().coworkSessionRepo,
    }),
);
