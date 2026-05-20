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
 * artifact. Missing sessions 404 via the handler's `NotFoundError`. Namespace
 * gating is enforced inside the handler (api-key callers pass; user callers
 * must be in the parent instance's namespace) and surfaces as 403 via
 * `ForbiddenError`.
 */
export const GET = createRouteAdapter<
  typeof GetCoworkSessionInputSchema,
  GetCoworkSessionInput,
  unknown,
  RouteContext
>(
  GetCoworkSessionInputSchema,
  async (_req, ctx) => ({ sessionId: (await ctx.params).sessionId }),
  (input, caller) => {
    const { coworkSessionRepo, instanceRepo } = getPlatformServices();
    return getCoworkSession(input, { coworkSessionRepo, instanceRepo }, caller);
  },
);
