import { NextRequest } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter, readJsonBody } from '@/lib/route-adapter';
import { completeTask } from '@mediforce/platform-api/handlers';
import { CompleteTaskInputSchema } from '@mediforce/platform-api/contract';
import type { CompleteTaskInput } from '@mediforce/platform-api/contract';
import { triggerAutoRunner } from '@/lib/trigger-auto-runner';

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

/**
 * POST /api/tasks/:taskId/complete
 *
 * Body: `{ verdict: 'approve' | 'revise'; comment?: string }`.
 * Resumes the paused process instance, advances the engine one step, and
 * kicks the auto-runner (fire-and-forget).
 */
export const POST = createRouteAdapter<
  typeof CompleteTaskInputSchema,
  CompleteTaskInput,
  RouteContext
>(
  CompleteTaskInputSchema,
  async (req: NextRequest, ctx) => {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    return {
      taskId: (await ctx.params).taskId,
      verdict: body.verdict,
      comment: body.comment,
    };
  },
  (input) => {
    const { humanTaskRepo, instanceRepo, auditRepo, engine } =
      getPlatformServices();
    return completeTask(input, {
      humanTaskRepo,
      instanceRepo,
      auditRepo,
      engine,
      triggerRun: triggerAutoRunner,
    });
  },
);
