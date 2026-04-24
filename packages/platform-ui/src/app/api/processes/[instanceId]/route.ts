import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter } from '@/lib/route-adapter';
import { getProcess } from '@mediforce/platform-api/handlers';
import { GetProcessInputSchema } from '@mediforce/platform-api/contract';
import type { GetProcessInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ instanceId: string }>;
}

/**
 * GET /api/processes/:instanceId — the single ProcessInstance document.
 * Missing instances → 404 via `NotFoundError`.
 */
export const GET = createRouteAdapter<typeof GetProcessInputSchema, GetProcessInput, RouteContext>(
  GetProcessInputSchema,
  async (_req, ctx) => ({ instanceId: (await ctx.params).instanceId }),
  (input) => getProcess(input, { instanceRepo: getPlatformServices().instanceRepo }),
);
