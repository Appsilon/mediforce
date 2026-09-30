import type { z } from 'zod';
import { createRouteAdapter } from '@/lib/route-adapter';
import { archiveEvalCase } from '@mediforce/platform-api/handlers';
import { ArchiveEvalCaseInputSchema } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ caseId: string }>;
}

/** POST /api/evaluation/cases/:caseId/archive — Archives (or restores) an Eval Case. */
export const POST = createRouteAdapter<typeof ArchiveEvalCaseInputSchema, z.infer<typeof ArchiveEvalCaseInputSchema>, unknown, RouteContext>(
  ArchiveEvalCaseInputSchema,
  async (req, ctx) => ({
    ...((await req.json().catch(() => ({}))) as Record<string, unknown>),
    caseId: (await ctx.params).caseId,
  }),
  archiveEvalCase,
);
