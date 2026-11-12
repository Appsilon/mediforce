import { z } from 'zod';
import { EvaluationOwnerSchema } from './evaluation';

/**
 * A Comparison (ADR-0024 D4): a baseline Eval Run and one to four Variant Eval
 * Runs of one subject on one Eval Dataset version, prepared as one and started
 * with one budget confirmation. The runs it prepared carry its id; a reused
 * baseline does not, so it is named here.
 */
export const EvalComparisonStatusSchema = z.enum(['prepared', 'running', 'completed', 'cancelled']);

export const EvalComparisonSchema = EvaluationOwnerSchema.extend({
  id: z.uuid(),
  datasetVersionId: z.uuid(),
  trialsPerCase: z.number().int().min(1).max(10),
  baselineEvalRunId: z.uuid(),
  /** Whether the baseline is a finished run that matched every frozen input, so the Comparison spends nothing on it. */
  baselineReused: z.boolean(),
  status: EvalComparisonStatusSchema,
  /** The sum of the budgets of the runs it prepared — what a person confirms once. */
  budgetUsd: z.number().nonnegative(),
  createdBy: z.string().min(1),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
});

/** Which cases a call reads: every case, or one side of the dev/holdout split. */
export const ComparisonScopeSchema = z.enum(['all', 'dev', 'holdout']);

/** How a Variant fared against the baseline on one Evaluator (ADR-0024 D5). */
export const ComparisonCallSchema = z.enum(['better', 'worse', 'no_clear_difference', 'too_few_cases']);

/** One counted Evaluator's paired result for one Variant against the baseline, over one scope of cases. */
export const ComparisonEvaluatorCallSchema = z.object({
  evaluatorId: z.uuid(),
  scope: ComparisonScopeSchema,
  /** Cases where the Variant's pass rate over its trials was higher than the baseline's. */
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  ties: z.number().int().nonnegative(),
  /** Two-sided exact sign test over wins and losses; null when every case tied. */
  pValue: z.number().min(0).max(1).nullable(),
  call: ComparisonCallSchema,
});

export type EvalComparisonStatus = z.infer<typeof EvalComparisonStatusSchema>;
export type EvalComparison = z.infer<typeof EvalComparisonSchema>;
export type ComparisonScope = z.infer<typeof ComparisonScopeSchema>;
export type ComparisonCall = z.infer<typeof ComparisonCallSchema>;
export type ComparisonEvaluatorCall = z.infer<typeof ComparisonEvaluatorCallSchema>;
