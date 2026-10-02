import type { z } from 'zod';
import { createRouteAdapter } from '@/lib/route-adapter';
import { reviewJudgeVerdict } from '@mediforce/platform-api/handlers';
import { ReviewJudgeVerdictInputSchema } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ evalRunId: string }>;
}

/** POST /api/evaluation/runs/:evalRunId/judge-reviews — A person accepts or denies one judge verdict after reading its rationale. */
export const POST = createRouteAdapter<typeof ReviewJudgeVerdictInputSchema, z.infer<typeof ReviewJudgeVerdictInputSchema>, unknown, RouteContext>(
  ReviewJudgeVerdictInputSchema,
  async (req, ctx) => ({
    ...((await req.json().catch(() => ({}))) as Record<string, unknown>),
    evalRunId: (await ctx.params).evalRunId,
  }),
  reviewJudgeVerdict,
);
