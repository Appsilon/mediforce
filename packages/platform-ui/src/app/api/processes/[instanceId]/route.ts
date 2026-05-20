import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter } from '@/lib/route-adapter';
import { getProcess } from '@mediforce/platform-api/handlers';
import { GetProcessInputSchema } from '@mediforce/platform-api/contract';
import type { GetProcessInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ instanceId: string }>;
}

/**
 * GET /api/processes/:instanceId
 *
 * Returns the full process instance. Missing instances 404 via the handler's
 * `NotFoundError`. Namespace gating is enforced inside the handler (api-key
 * callers pass; user callers must be in the instance's namespace) and
 * surfaces as 403 via `ForbiddenError`.
 */
export const GET = createRouteAdapter<
  typeof GetProcessInputSchema,
  GetProcessInput,
  unknown,
  RouteContext
>(
  GetProcessInputSchema,
  async (_req, ctx) => ({ instanceId: (await ctx.params).instanceId }),
  (input, caller) => {
    const { instanceRepo } = getPlatformServices();
    return getProcess(input, { instanceRepo }, caller);
  },
);
