import { createRouteAdapter } from '@/lib/route-adapter';
import { getAssistantInstructions, setAssistantInstructions } from '@mediforce/platform-api/handlers';
import {
  GetAssistantInstructionsInputSchema,
  SetAssistantInstructionsInputSchema,
} from '@mediforce/platform-api/contract';

/**
 * GET /api/workflow-assistant/instructions?namespace=…
 *
 * The caller's own standing instructions for the assistant in that workspace —
 * the extra system prompt every turn there reads.
 */
export const GET = createRouteAdapter(
  GetAssistantInstructionsInputSchema,
  (req) => ({
    namespace: req.nextUrl.searchParams.get('namespace') ?? undefined,
    uid: req.nextUrl.searchParams.get('uid') ?? undefined,
  }),
  getAssistantInstructions,
);

/**
 * PUT /api/workflow-assistant/instructions — replace them. `instructions: ''`
 * clears them.
 */
export const PUT = createRouteAdapter(
  SetAssistantInstructionsInputSchema,
  async (req) => (await req.json().catch(() => ({}))) as Record<string, unknown>,
  setAssistantInstructions,
);
