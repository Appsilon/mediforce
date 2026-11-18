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
  async (req, ctx) => {
    const { instanceId, stepId } = await ctx.params;
    const body = await req.json().catch(() => ({})) as { allowAgentDrift?: boolean };
    return { runId: instanceId, stepId, allowAgentDrift: body.allowAgentDrift };
  },
  retryStep,
);
