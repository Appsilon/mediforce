import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter } from '@/lib/route-adapter';
import { cancelProcess } from '@mediforce/platform-api/handlers';
import { CancelProcessInputSchema } from '@mediforce/platform-api/contract';
import type { CancelProcessInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ instanceId: string }>;
}

/**
 * POST /api/processes/:instanceId/cancel
 */
export const POST = createRouteAdapter<
  typeof CancelProcessInputSchema,
  CancelProcessInput,
  RouteContext
>(
  CancelProcessInputSchema,
  async (_req, ctx) => ({ instanceId: (await ctx.params).instanceId }),
  (input) =>
    cancelProcess(input, { instanceRepo: getPlatformServices().instanceRepo }),
);
