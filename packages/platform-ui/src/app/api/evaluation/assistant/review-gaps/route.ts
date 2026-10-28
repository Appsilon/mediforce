import { createRouteAdapter } from '@/lib/route-adapter';
import { askAboutReviewGaps } from '@mediforce/platform-api/handlers';
import { AskAboutReviewGapsInputSchema } from '@mediforce/platform-api/contract';

/**
 * POST /api/evaluation/assistant/review-gaps — feeds `review_gap` Scores
 * since `since` into the Step's Evaluation Assistant, only when at least one
 * names something the step's output missed (ADR-0023 D14).
 */
export const POST = createRouteAdapter(
  AskAboutReviewGapsInputSchema,
  async (req) => req.json().catch(() => ({})),
  askAboutReviewGaps,
);
