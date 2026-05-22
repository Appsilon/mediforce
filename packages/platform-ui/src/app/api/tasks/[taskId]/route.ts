import { createRouteAdapter } from '@/lib/route-adapter';
import { getByIdAdapter } from '@mediforce/platform-api/handlers';
import { GetTaskInputSchema } from '@mediforce/platform-api/contract';
import type { GetTaskInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

/**
 * GET /api/tasks/:taskId
 *
 * Returns the full task including completionData. Missing tasks and cross-
 * workspace access both surface as 404 — `scope.tasks.getById` returns null
 * for out-of-scope rows.
 */
export const GET = createRouteAdapter<typeof GetTaskInputSchema, GetTaskInput, unknown, RouteContext>(
  GetTaskInputSchema,
  async (_req, ctx) => ({ taskId: (await ctx.params).taskId }),
  getByIdAdapter((input, scope) => scope.tasks.getById(input.taskId), 'Task not found'),
);
