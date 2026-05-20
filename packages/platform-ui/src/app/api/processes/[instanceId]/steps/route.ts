import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter } from '@/lib/route-adapter';
import { getProcessSteps } from '@mediforce/platform-api/handlers';
import { GetProcessStepsInputSchema } from '@mediforce/platform-api/contract';
import type { GetProcessStepsInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ instanceId: string }>;
}

/**
 * GET /api/processes/:instanceId/steps
 *
 * Derived per-step view: walks the workflow definition in order, joins each
 * step's latest execution + `instance.variables[stepId]`, and tags every
 * step with `completed | running | pending`. Missing instance or definition
 * → 404 via `NotFoundError`. Namespace gating enforced inside the handler.
 */
export const GET = createRouteAdapter<
  typeof GetProcessStepsInputSchema,
  GetProcessStepsInput,
  unknown,
  RouteContext
>(
  GetProcessStepsInputSchema,
  async (_req, ctx) => ({ instanceId: (await ctx.params).instanceId }),
  (input, caller) => {
    const { instanceRepo, processRepo } = getPlatformServices();
    return getProcessSteps(input, { instanceRepo, processRepo }, caller);
  },
);
