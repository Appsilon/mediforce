import { z } from 'zod';
import { EvaluationAssistantProposalSchema, EvaluationSubjectRefSchema } from '@mediforce/platform-core';
import { PreviewEvaluatorOutputSchema } from './evaluation';

/**
 * Contract for `POST /api/evaluation/assistant` — one turn with a Step's
 * Evaluation Assistant (ADR-0023 D14–D16). Proposals come back for the person
 * to accept or reject; a prepared Eval Run comes back for them to start
 * by confirming its budget.
 */
export const AskEvaluationAssistantInputSchema = EvaluationSubjectRefSchema.extend({
  /** The Workflow Definition version whose step the assistant reads and runs; its runnable version when absent. */
  definitionVersion: z.number().int().positive().optional(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(20_000),
  })).min(1).max(100),
  model: z.string().min(1).optional(),
  /**
   * An unattended budget the person grants for this request (D15): the
   * assistant may start prepared Eval Runs of this step whose budgets together
   * fit it. Without it, starting one is refused.
   */
  unattendedBudgetUsd: z.number().positive().max(10_000).optional(),
});

export const PreparedEvalRunSchema = z.object({
  evalRunId: z.uuid(),
  budgetUsd: z.number().positive(),
  estimatedUsd: z.number().nonnegative().nullable(),
  trials: z.number().int().nonnegative(),
});

/** An Eval Run the assistant started under the request's unattended budget. */
export const StartedEvalRunSchema = z.object({
  evalRunId: z.uuid(),
  budgetUsd: z.number().positive(),
});

/**
 * A proposed check tried by the platform on the step's recent production
 * outputs before the person sees it — or why it could not be (no `run` verb).
 */
export const EvaluatorSelfTestSchema = z.union([
  PreviewEvaluatorOutputSchema,
  z.object({ unavailable: z.string() }),
]);

/** A proposal as the person sees it; a proposed check carries its self-test. */
export const ProposalViewSchema = EvaluationAssistantProposalSchema.and(z.object({
  selfTest: EvaluatorSelfTestSchema.optional(),
}));

export const AskEvaluationAssistantOutputSchema = z.object({
  reply: z.string(),
  proposals: z.array(ProposalViewSchema),
  preparedEvalRuns: z.array(PreparedEvalRunSchema),
  /** Runs started under `unattendedBudgetUsd`; empty without one. */
  startedEvalRuns: z.array(StartedEvalRunSchema),
});

/** One step of a turn in progress, streamed while the assistant works. */
export const EvaluationAssistantProgressSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('thinking'), round: z.number().int().positive() }),
  z.object({
    type: z.literal('tool'),
    round: z.number().int().positive(),
    callId: z.string(),
    tool: z.string(),
    status: z.enum(['running', 'done', 'failed']),
    error: z.string().optional(),
  }),
]);

/**
 * Contract for `POST /api/evaluation/assistant/review-gaps` — feeds the
 * production-review feedback loop (`review_gap` Scores, see
 * `classify-review-gap.ts`) into the Step's Evaluation Assistant: only when
 * at least one reviewer correction since `since` named something the step's
 * output missed does this ask the Assistant to diagnose and propose a fix.
 * Agent-only subjects are refused — review_gap Scores carry a stepId, not an
 * agentId, so only a Step's own gaps can be attributed correctly.
 */
export const AskAboutReviewGapsInputSchema = EvaluationSubjectRefSchema.extend({
  definitionVersion: z.number().int().positive().optional(),
  /** Only `review_gap` Scores recorded at or after this time count as new. */
  since: z.iso.datetime(),
  model: z.string().min(1).optional(),
  unattendedBudgetUsd: z.number().positive().max(10_000).optional(),
});

export const AskAboutReviewGapsOutputSchema = z.object({
  /** How many `review_gap` Scores since `since` had the judge say the output missed something. */
  missedCount: z.number().int().nonnegative(),
  /** Set only when `missedCount` > 0 — the Assistant was actually asked. */
  assistant: AskEvaluationAssistantOutputSchema.nullable(),
});

export type AskAboutReviewGapsInput = z.infer<typeof AskAboutReviewGapsInputSchema>;
export type AskAboutReviewGapsOutput = z.infer<typeof AskAboutReviewGapsOutputSchema>;

export type AskEvaluationAssistantInput = z.infer<typeof AskEvaluationAssistantInputSchema>;
export type AskEvaluationAssistantOutput = z.infer<typeof AskEvaluationAssistantOutputSchema>;
export type PreparedEvalRun = z.infer<typeof PreparedEvalRunSchema>;
export type StartedEvalRun = z.infer<typeof StartedEvalRunSchema>;
export type EvaluationAssistantProgress = z.infer<typeof EvaluationAssistantProgressSchema>;
export type EvaluatorSelfTest = z.infer<typeof EvaluatorSelfTestSchema>;
export type ProposalView = z.infer<typeof ProposalViewSchema>;
