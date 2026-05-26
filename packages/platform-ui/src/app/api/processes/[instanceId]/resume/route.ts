import { createRouteAdapter } from '@/lib/route-adapter';
import { resumeRun } from '@mediforce/platform-api/handlers';
import { ResumeRunInputSchema } from '@mediforce/platform-api/contract';
import type { ResumeRunInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ instanceId: string }>;
}

export const POST = createRouteAdapter<
  typeof ResumeRunInputSchema,
  ResumeRunInput,
  unknown,
  RouteContext
>(
  ResumeRunInputSchema,
  async (_req, ctx) => ({ runId: (await ctx.params).instanceId }),
  resumeRun,
);
