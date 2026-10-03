import type { z } from 'zod';
import { createRouteAdapter } from '@/lib/route-adapter';
import { getEvalTrial } from '@mediforce/platform-api/handlers';
import { GetEvalTrialInputSchema } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ evalRunId: string; trialId: string }>;
}

/** GET /api/evaluation/runs/:evalRunId/trials/:trialId — One trial with its case, input, log, output, and every Evaluator's check, grade and judge prompt. */
export const GET = createRouteAdapter<typeof GetEvalTrialInputSchema, z.infer<typeof GetEvalTrialInputSchema>, unknown, RouteContext>(
  GetEvalTrialInputSchema,
  async (_req, ctx) => {
    const { evalRunId, trialId } = await ctx.params;
    return { evalRunId, trialId };
  },
  getEvalTrial,
);
