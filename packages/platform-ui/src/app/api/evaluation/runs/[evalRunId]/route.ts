import type { z } from 'zod';
import { createRouteAdapter } from '@/lib/route-adapter';
import { getEvalRun } from '@mediforce/platform-api/handlers';
import { GetEvalRunInputSchema } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ evalRunId: string }>;
}

/** GET /api/evaluation/runs/:evalRunId — The Eval Run, its trials and its report. */
export const GET = createRouteAdapter<typeof GetEvalRunInputSchema, z.infer<typeof GetEvalRunInputSchema>, unknown, RouteContext>(
  GetEvalRunInputSchema,
  async (_req, ctx) => ({ evalRunId: (await ctx.params).evalRunId }),
  getEvalRun,
);
