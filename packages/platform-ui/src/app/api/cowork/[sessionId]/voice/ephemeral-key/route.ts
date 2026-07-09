import { createRouteAdapter } from '@/lib/route-adapter';
import { createVoiceEphemeralKey } from '@mediforce/platform-api/handlers';
import { CreateVoiceEphemeralKeyInputSchema } from '@mediforce/platform-api/contract';
import type { CreateVoiceEphemeralKeyInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

/**
 * POST /api/cowork/:sessionId/voice/ephemeral-key
 *
 * Mints an OpenAI Realtime ephemeral key for direct WebRTC connection from
 * the browser. Only valid for `agent === 'voice-realtime'` sessions.
 */
export const POST = createRouteAdapter<
  typeof CreateVoiceEphemeralKeyInputSchema,
  CreateVoiceEphemeralKeyInput,
  unknown,
  RouteContext
>(
  CreateVoiceEphemeralKeyInputSchema,
  async (_req, ctx) => ({ sessionId: (await ctx.params).sessionId }),
  createVoiceEphemeralKey,
);
