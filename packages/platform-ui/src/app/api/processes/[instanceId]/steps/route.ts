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
 * Derived view — walks the definition in order and joins in each step's
 * latest execution plus the human-step slice of `instance.variables`.
 * Behaviour is ported verbatim from the pre-migration route; see
 * `getProcessSteps` for the algorithm and status-derivation rules.
 */
export const GET = createRouteAdapter<
  typeof GetProcessStepsInputSchema,
  GetProcessStepsInput,
  RouteContext
>(
  GetProcessStepsInputSchema,
  async (_req, ctx) => ({ instanceId: (await ctx.params).instanceId }),
  (input) => {
    const { instanceRepo, processRepo } = getPlatformServices();
    return getProcessSteps(input, { instanceRepo, processRepo });
  },
);
