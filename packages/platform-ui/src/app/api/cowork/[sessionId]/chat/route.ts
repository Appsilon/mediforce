import type { NextRequest } from 'next/server';
import { createRouteAdapter } from '@/lib/route-adapter';
import { chatCoworkSession } from '@mediforce/platform-api/handlers';
import { ChatCoworkSessionInputSchema } from '@mediforce/platform-api/contract';
import type { ChatCoworkSessionInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

/**
 * POST /api/cowork/:sessionId/chat
 *
 * Sends a human message into the cowork session, runs the MCP tool loop
 * server-side (≤10 iterations), persists intermediate tool turns to the
 * session, and returns the final agent text plus optional artifact.
 */
export const POST = createRouteAdapter<
  typeof ChatCoworkSessionInputSchema,
  ChatCoworkSessionInput,
  unknown,
  RouteContext
>(
  ChatCoworkSessionInputSchema,
  async (req: NextRequest, ctx) => {
    const { sessionId } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { message?: unknown };
    return { sessionId, message: body.message };
  },
  chatCoworkSession,
);
