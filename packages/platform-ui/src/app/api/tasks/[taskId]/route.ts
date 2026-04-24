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
 * Returns the full task including completionData. A missing task surfaces
 * as a 404 via the handler's `NotFoundError`; the route adapter performs
 * the HTTP mapping.
 */
export const GET = createRouteAdapter<typeof GetTaskInputSchema, GetTaskInput, RouteContext>(
  GetTaskInputSchema,
  async (_req, ctx) => ({ taskId: (await ctx.params).taskId }),
  (input) => getTask(input, { humanTaskRepo: getPlatformServices().humanTaskRepo }),
);
