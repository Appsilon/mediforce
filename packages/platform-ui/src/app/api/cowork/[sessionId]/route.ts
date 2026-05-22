import { createRouteAdapter } from '@/lib/route-adapter';
import { getByIdAdapter } from '@mediforce/platform-api/handlers';
import { GetCoworkSessionInputSchema } from '@mediforce/platform-api/contract';
import type { GetCoworkSessionInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

/**
 * GET /api/cowork/:sessionId
 *
 * Returns the cowork session including conversation history and current
 * artifact. Missing/cross-workspace sessions 404 via `scope.coworkSessions`.
 */
export const GET = createRouteAdapter<
  typeof GetCoworkSessionInputSchema,
  GetCoworkSessionInput,
  unknown,
  RouteContext
>(
  GetCoworkSessionInputSchema,
  async (_req, ctx) => ({ sessionId: (await ctx.params).sessionId }),
  getByIdAdapter(
    (input, scope) => scope.coworkSessions.getById(input.sessionId),
    (input) => `Cowork session ${input.sessionId} not found`,
  ),
);
