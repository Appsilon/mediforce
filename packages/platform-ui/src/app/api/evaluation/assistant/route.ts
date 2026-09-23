import { createRouteAdapter } from '@/lib/route-adapter';
import { askEvaluationAssistant } from '@mediforce/platform-api/handlers';
import { AskEvaluationAssistantInputSchema } from '@mediforce/platform-api/contract';

/**
 * POST /api/evaluation/assistant — one turn with a Step's Evaluation Assistant
 * (ADR-0023 D14). Proposals and prepared Eval Runs come back for the person to act on.
 */
export const POST = createRouteAdapter(
  AskEvaluationAssistantInputSchema,
  async (req) => req.json().catch(() => ({})),
  askEvaluationAssistant,
);
