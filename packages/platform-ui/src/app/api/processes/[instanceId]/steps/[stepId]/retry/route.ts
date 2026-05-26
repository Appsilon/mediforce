import { createRouteAdapter } from '@/lib/route-adapter';
import { retryStep } from '@mediforce/platform-api/handlers';
import { RetryStepInputSchema } from '@mediforce/platform-api/contract';
import type { RetryStepInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ instanceId: string; stepId: string }>;
}

/**
 * POST /api/processes/:instanceId/steps/:stepId/retry
 *
 * Delegates state reset to `engine.retryStep`; handler emits the
 * Phase 3 `instance.retried` audit and kicks the auto-runner.
 */
export const POST = createRouteAdapter<
  typeof RetryStepInputSchema,
  RetryStepInput,
  unknown,
  RouteContext
>(
  RetryStepInputSchema,
  async (_req, ctx) => {
    const { instanceId, stepId } = await ctx.params;
    return { runId: instanceId, stepId };
  },
  retryStep,
);
