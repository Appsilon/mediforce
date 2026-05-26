import { createRouteAdapter } from '@/lib/route-adapter';
import { completeTask } from '@mediforce/platform-api/handlers';
import { CompleteTaskInputSchema } from '@mediforce/platform-api/contract';
import type { CompleteTaskInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

/**
 * POST /api/tasks/:taskId/complete
 *
 * Discriminated-union body (`kind` field) — verdict | params | upload |
 * assignment | rows. The handler delegates state-machine work to
 * `engine.completeHumanTask`, emits `task.completed` + `process.resumed_after_task`
 * audits, and kicks the auto-runner. Response is the post-completion entity
 * echo (`{ task, run }`) per ADR-0005 §5.
 */
export const POST = createRouteAdapter<
  typeof CompleteTaskInputSchema,
  CompleteTaskInput,
  unknown,
  RouteContext
>(
  CompleteTaskInputSchema,
  async (req, ctx) => ({
    taskId: (await ctx.params).taskId,
    payload: (await req.json().catch(() => ({}))) as unknown,
  }),
  completeTask,
);
