import { createProgressRouteAdapter } from '@/lib/route-adapter';
import { askEvaluationAssistant } from '@mediforce/platform-api/handlers';
import { AskEvaluationAssistantInputSchema } from '@mediforce/platform-api/contract';

/**
 * POST /api/evaluation/assistant — one turn with a Step's Evaluation Assistant
 * (ADR-0023 D14). Proposals and prepared Eval Runs come back for the person to act on.
 * With `Accept: application/x-ndjson` it streams the turn's progress before the result.
 */
export const POST = createProgressRouteAdapter(
  AskEvaluationAssistantInputSchema,
  async (req) => req.json().catch(() => ({})),
  askEvaluationAssistant,
);
