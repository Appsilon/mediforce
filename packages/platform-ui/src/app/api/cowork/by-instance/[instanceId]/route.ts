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
 * Workspace gating in `scope.coworkSessions` (gates on the parent run).
 */
export const GET = createRouteAdapter<
  typeof GetCoworkSessionByInstanceInputSchema,
  GetCoworkSessionByInstanceInput,
  unknown,
  RouteContext
>(
  GetCoworkSessionByInstanceInputSchema,
  async (_req, ctx) => ({ instanceId: (await ctx.params).instanceId }),
  getCoworkSessionByInstance,
);
