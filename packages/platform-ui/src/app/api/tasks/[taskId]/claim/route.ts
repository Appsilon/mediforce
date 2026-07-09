import { createRouteAdapter } from '@/lib/route-adapter';
import { claimTask } from '@mediforce/platform-api/handlers';
import { ClaimTaskInputSchema } from '@mediforce/platform-api/contract';
import type { ClaimTaskInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

/**
 * POST /api/tasks/:taskId/claim
 *
 * Claims a pending task for the calling user. Status precondition
 * (`pending → claimed`) and caller-kind gate (user only — apiKey is
 * refused with `forbidden`) live in the handler.
 *
 * Body shape change vs the pre-migration route (ADR-0005 §5 / §6 +
 * PR1 of Phase 2):
 *   - Input no longer accepts `{ userId }`. The claimer's identity comes
 *     from the auth carrier (`scope.caller`), not the request body.
 *   - Response no longer echoes the bare task; it returns the entity
 *     envelope `{ task: HumanTask }`.
 */
export const POST = createRouteAdapter<
  typeof ClaimTaskInputSchema,
  ClaimTaskInput,
  unknown,
  RouteContext
>(
  ClaimTaskInputSchema,
  async (_req, ctx) => ({ taskId: (await ctx.params).taskId }),
  claimTask,
);
