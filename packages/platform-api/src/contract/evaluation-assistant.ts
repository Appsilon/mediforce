import { z } from 'zod';
import { EvaluatedStepSchema, EvaluationAssistantProposalSchema } from '@mediforce/platform-core';

/**
 * Contract for `POST /api/evaluation/assistant` — one turn with a Step's
 * Evaluation Assistant (ADR-0023 D14–D16). Proposals come back for the person
 * to accept, edit or reject; a prepared Eval Run comes back for them to start
 * by confirming its budget.
 */
export const AskEvaluationAssistantInputSchema = EvaluatedStepSchema.extend({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(20_000),
  })).min(1).max(100),
  model: z.string().min(1).optional(),
});

export const PreparedEvalRunSchema = z.object({
  evalRunId: z.uuid(),
  budgetUsd: z.number().positive(),
  estimatedUsd: z.number().nonnegative().nullable(),
  trials: z.number().int().nonnegative(),
});

export const AskEvaluationAssistantOutputSchema = z.object({
  reply: z.string(),
  proposals: z.array(EvaluationAssistantProposalSchema),
  preparedEvalRuns: z.array(PreparedEvalRunSchema),
});

export type AskEvaluationAssistantInput = z.infer<typeof AskEvaluationAssistantInputSchema>;
export type AskEvaluationAssistantOutput = z.infer<typeof AskEvaluationAssistantOutputSchema>;
export type PreparedEvalRun = z.infer<typeof PreparedEvalRunSchema>;
