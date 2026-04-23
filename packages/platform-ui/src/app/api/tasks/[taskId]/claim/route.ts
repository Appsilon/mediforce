import { NextRequest } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter, readJsonBody } from '@/lib/route-adapter';
import { claimTask } from '@mediforce/platform-api/handlers';
import { ClaimTaskInputSchema } from '@mediforce/platform-api/contract';
import type { ClaimTaskInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

/**
 * POST /api/tasks/:taskId/claim
 *
 * Body: `{ userId?: string }` — defaults server-side to `'api-user'`.
 */
export const POST = createRouteAdapter<
  typeof ClaimTaskInputSchema,
  ClaimTaskInput,
  RouteContext
>(
  ClaimTaskInputSchema,
  async (req: NextRequest, ctx) => {
    const body = (await readJsonBody(req)) as { userId?: string };
    return {
      taskId: (await ctx.params).taskId,
      userId: body.userId,
    };
  },
  (input) => {
    const { humanTaskRepo, auditRepo } = getPlatformServices();
    return claimTask(input, { humanTaskRepo, auditRepo });
  },
);
