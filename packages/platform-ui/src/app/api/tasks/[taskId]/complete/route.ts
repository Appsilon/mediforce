import { createRouteAdapter } from '@/lib/route-adapter';
import { completeTask } from '@mediforce/platform-api/handlers';
import { CompleteTaskInputSchema } from '@mediforce/platform-api/contract';
import type { CompleteTaskInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

export const POST = createRouteAdapter<typeof CompleteTaskInputSchema, CompleteTaskInput, unknown, RouteContext>(
  CompleteTaskInputSchema,
  async (req, ctx) => ({
    taskId: (await ctx.params).taskId,
    payload: (await req.json().catch(() => ({}))) as unknown,
  }),
  completeTask,
);
