import { createProgressRouteAdapter } from '@/lib/route-adapter';
import { askAgentAssistant } from '@mediforce/platform-api/handlers';
import { AskAgentAssistantInputSchema } from '@mediforce/platform-api/contract';

/**
 * POST /api/agent-assistant — one turn with the namespace's Agent Assistant.
 * With `Accept: application/x-ndjson` it streams the turn's progress before the result.
 */
export const POST = createProgressRouteAdapter(
  AskAgentAssistantInputSchema,
  async (req) => req.json().catch(() => ({})),
  askAgentAssistant,
);
