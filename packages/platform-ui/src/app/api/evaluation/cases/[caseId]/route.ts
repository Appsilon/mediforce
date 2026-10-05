import type { z } from 'zod';
import { createRouteAdapter } from '@/lib/route-adapter';
import { updateEvalCase } from '@mediforce/platform-api/handlers';
import { UpdateEvalCaseInputSchema } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ caseId: string }>;
}

/** PATCH /api/evaluation/cases/:caseId — Edits an Eval Case as a new case that replaces it; the old one is archived. */
export const PATCH = createRouteAdapter<typeof UpdateEvalCaseInputSchema, z.infer<typeof UpdateEvalCaseInputSchema>, unknown, RouteContext>(
  UpdateEvalCaseInputSchema,
  async (req, ctx) => ({
    ...((await req.json().catch(() => ({}))) as Record<string, unknown>),
    caseId: (await ctx.params).caseId,
  }),
  updateEvalCase,
);
