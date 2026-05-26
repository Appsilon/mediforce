import type { NextRequest } from 'next/server';
import { createRouteAdapter } from '@/lib/route-adapter';
import { synthesizeVoiceArtifact } from '@mediforce/platform-api/handlers';
import { SynthesizeVoiceArtifactInputSchema } from '@mediforce/platform-api/contract';
import type { SynthesizeVoiceArtifactInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

/**
 * POST /api/cowork/:sessionId/voice/synthesize
 *
 * Converts a completed voice transcript into a structured artifact and
 * persists the parsed conversation turns. Single blocking JSON-mode LLM
 * call via OpenRouter (workspace secrets).
 */
export const POST = createRouteAdapter<
  typeof SynthesizeVoiceArtifactInputSchema,
  SynthesizeVoiceArtifactInput,
  unknown,
  RouteContext
>(
  SynthesizeVoiceArtifactInputSchema,
  async (req: NextRequest, ctx) => {
    const { sessionId } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      transcript?: unknown;
      comment?: unknown;
    };
    return { sessionId, transcript: body.transcript, comment: body.comment };
  },
  synthesizeVoiceArtifact,
);
