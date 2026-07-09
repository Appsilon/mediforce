import { createRouteAdapter } from '@/lib/route-adapter';
import { resumeWait } from '@mediforce/platform-api/handlers';
import { ResumeWaitInputSchema } from '@mediforce/platform-api/contract';
import type { ResumeWaitInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ instanceId: string }>;
}

export const POST = createRouteAdapter<
  typeof ResumeWaitInputSchema,
  ResumeWaitInput,
  unknown,
  RouteContext
>(
  ResumeWaitInputSchema,
  async (_req, ctx) => ({ runId: (await ctx.params).instanceId }),
  resumeWait,
);
