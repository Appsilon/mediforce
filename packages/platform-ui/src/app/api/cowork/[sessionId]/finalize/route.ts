import type { NextRequest } from 'next/server';
import { createRouteAdapter } from '@/lib/route-adapter';
import { finalizeCoworkSession } from '@mediforce/platform-api/handlers';
import { FinalizeCoworkSessionInputSchema } from '@mediforce/platform-api/contract';
import type { FinalizeCoworkSessionInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

/**
 * POST /api/cowork/:sessionId/finalize
 *
 * Finalizes the session: persists artifact, resumes the paused instance,
 * advances the workflow with the artifact as step output, and kicks the
 * runner via `scope.system.runKicker`. Multi-repo writes are best-effort.
 */
export const POST = createRouteAdapter<
  typeof FinalizeCoworkSessionInputSchema,
  FinalizeCoworkSessionInput,
  unknown,
  RouteContext
>(
  FinalizeCoworkSessionInputSchema,
  async (req: NextRequest, ctx) => {
    const { sessionId } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { artifact?: unknown };
    return { sessionId, artifact: body.artifact };
  },
  finalizeCoworkSession,
);
