import { z } from 'zod';
import { ScoreSchema } from '@mediforce/platform-core';

/**
 * Contract for `GET /api/scores` — Scores (ADR-0023), newest first. Workspace
 * gating comes from the caller's scope; `namespace` narrows inside it. Every
 * other filter narrows further:
 *
 *   - `agentRunId` — Scores whose subject is this Agent Run
 *   - `runId`      — Scores correlated with this Workflow Run
 *   - `stepId`     — within `runId` (a stepId alone is ambiguous across runs)
 *   - `name`       — one kind of Score, e.g. `human_verdict`
 */
export const ListScoresInputSchema = z
  .object({
    namespace: z.string().min(1).optional(),
    agentRunId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    stepId: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(1_000).optional(),
  })
  .refine((input) => input.stepId === undefined || input.runId !== undefined, {
    message: 'stepId requires runId',
    path: ['stepId'],
  });

export const ListScoresOutputSchema = z.object({
  scores: z.array(ScoreSchema),
});

export type ListScoresInput = z.infer<typeof ListScoresInputSchema>;
export type ListScoresOutput = z.infer<typeof ListScoresOutputSchema>;
