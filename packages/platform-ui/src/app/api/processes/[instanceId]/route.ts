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
 * Returns the full process instance. Missing or cross-workspace 404 via the
 * `scope.runs` wrapper.
 */
export const GET = createRouteAdapter<
  typeof GetProcessInputSchema,
  GetProcessInput,
  unknown,
  RouteContext
>(
  GetProcessInputSchema,
  async (_req, ctx) => ({ instanceId: (await ctx.params).instanceId }),
  getProcess,
);
