import { createRouteAdapter } from '@/lib/route-adapter';
import { retryStep } from '@mediforce/platform-api/handlers';
import { RetryStepInputSchema } from '@mediforce/platform-api/contract';
import type { RetryStepInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ instanceId: string; stepId: string }>;
}

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
