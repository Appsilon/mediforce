import { NextRequest } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter, readJsonBody } from '@/lib/route-adapter';
import { resolveTask } from '@mediforce/platform-api/handlers';
import { ResolveTaskInputSchema } from '@mediforce/platform-api/contract';
import type { ResolveTaskInput } from '@mediforce/platform-api/contract';
import { triggerAutoRunner } from '@/lib/trigger-auto-runner';

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

/**
 * POST /api/tasks/:taskId/resolve
 *
 * One endpoint, three body shapes (verdict / paramValues / attachments).
 * Handler picks the path at runtime based on the task's own shape.
 */
export const POST = createRouteAdapter<
  typeof ResolveTaskInputSchema,
  ResolveTaskInput,
  RouteContext
>(
  ResolveTaskInputSchema,
  async (req: NextRequest, ctx) => {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    return { ...body, taskId: (await ctx.params).taskId };
  },
  (input) => {
    const { humanTaskRepo, instanceRepo, auditRepo, engine } =
      getPlatformServices();
    return resolveTask(input, {
      humanTaskRepo,
      instanceRepo,
      auditRepo,
      engine,
      triggerRun: triggerAutoRunner,
    });
  },
);
