import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter } from '@/lib/route-adapter';
import { resumeProcess } from '@mediforce/platform-api/handlers';
import { ResumeProcessInputSchema } from '@mediforce/platform-api/contract';
import type { ResumeProcessInput } from '@mediforce/platform-api/contract';
import { triggerAutoRunner } from '@/lib/trigger-auto-runner';

interface RouteContext {
  params: Promise<{ instanceId: string }>;
}

/**
 * POST /api/processes/:instanceId/resume
 */
export const POST = createRouteAdapter<
  typeof ResumeProcessInputSchema,
  ResumeProcessInput,
  RouteContext
>(
  ResumeProcessInputSchema,
  async (_req, ctx) => ({ instanceId: (await ctx.params).instanceId }),
  (input) => {
    const { instanceRepo, auditRepo } = getPlatformServices();
    return resumeProcess(input, {
      instanceRepo,
      auditRepo,
      triggerRun: triggerAutoRunner,
    });
  },
);
