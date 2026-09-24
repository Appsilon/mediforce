import type { z } from 'zod';
import { createRouteAdapter } from '@/lib/route-adapter';
import { cancelEvalRun } from '@mediforce/platform-api/handlers';
import { CancelEvalRunInputSchema } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ evalRunId: string }>;
}

/** POST /api/evaluation/runs/:evalRunId/cancel — Stops starting trials; running ones finish and are scored. */
export const POST = createRouteAdapter<typeof CancelEvalRunInputSchema, z.infer<typeof CancelEvalRunInputSchema>, unknown, RouteContext>(
  CancelEvalRunInputSchema,
  async (_req, ctx) => ({ evalRunId: (await ctx.params).evalRunId }),
  cancelEvalRun,
);
