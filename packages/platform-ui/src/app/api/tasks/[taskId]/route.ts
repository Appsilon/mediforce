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
 * Returns the full task including completionData. Missing tasks 404 via the
 * handler's `NotFoundError`. Namespace gating is enforced inside the handler
 * (api-key callers pass; user callers must be in the task's instance
 * namespace) and surfaces as 403 via `ForbiddenError`.
 */
export const GET = createRouteAdapter<typeof GetTaskInputSchema, GetTaskInput, unknown, RouteContext>(
  GetTaskInputSchema,
  async (_req, ctx) => ({ taskId: (await ctx.params).taskId }),
  (input, caller) => {
    const { humanTaskRepo, instanceRepo } = getPlatformServices();
    return getTask(input, { humanTaskRepo, instanceRepo }, caller);
  },
);
