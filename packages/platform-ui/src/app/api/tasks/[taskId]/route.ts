import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter } from '@/lib/route-adapter';
import { getTask } from '@mediforce/platform-api/handlers';
import { GetTaskInputSchema } from '@mediforce/platform-api/contract';
import type { GetTaskInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

/**
 * GET /api/tasks/:taskId
 *
 * Returns the full task including completionData. Missing tasks and cross-
 * namespace access both surface as 404 (anti-enumeration) — a non-member
 * caller cannot distinguish "this task exists but I can't see it" from
 * "this task doesn't exist".
 */
export const GET = createRouteAdapter<typeof GetTaskInputSchema, GetTaskInput, unknown, RouteContext>(
  GetTaskInputSchema,
  async (_req, ctx) => ({ taskId: (await ctx.params).taskId }),
  (input, caller) => {
    const { humanTaskRepo, instanceRepo } = getPlatformServices();
    return getTask(input, { humanTaskRepo, instanceRepo }, caller);
  },
);
