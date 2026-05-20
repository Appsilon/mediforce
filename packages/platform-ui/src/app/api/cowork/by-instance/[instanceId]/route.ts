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
 * Returns the most recent active cowork session for a given process
 * instance. 404 when the instance is unknown or has no active session.
 * Namespace gating is enforced inside the handler (api-key callers pass; user
 * callers must be in the instance's namespace) and surfaces as 403.
 */
export const GET = createRouteAdapter<
  typeof GetCoworkSessionByInstanceInputSchema,
  GetCoworkSessionByInstanceInput,
  unknown,
  RouteContext
>(
  GetCoworkSessionByInstanceInputSchema,
  async (_req, ctx) => ({ instanceId: (await ctx.params).instanceId }),
  (input, caller) => {
    const { coworkSessionRepo, instanceRepo } = getPlatformServices();
    return getCoworkSessionByInstance(
      input,
      { coworkSessionRepo, instanceRepo },
      caller,
    );
  },
);
