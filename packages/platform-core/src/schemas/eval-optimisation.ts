import { z } from 'zod';
import { EvaluatedStepSchema, StepVariantPatchSchema } from './evaluation';
import { EvalVariantSchema } from './eval-run';

/**
 * A GEPA optimisation of one Step's prompt (ADR-0023 D15, Phase 5): a container
 * job reflects on a finished Eval Run's trials of the dev cases and proposes
 * candidate prompts, which then run as challengers of a new Eval Run over the
 * Step's newest Dataset — dev and holdout cases alike — within a budget the
 * person granted for it. Ranking the candidates is computed from that run
 * when read, never stored.
 */
export const EvalOptimisationStatusSchema = z.enum([
  /** The job is proposing candidates. */
  'proposing',
  /** The candidates run in `evalRunId`; its status says when they are done. */
  'evaluating',
  /** The job failed, proposed nothing new, or spent the budget; `error` says which. */
  'failed',
]);

export const OptimisationCandidateSchema = z.object({
  /** Its challenger in the Eval Run; null until that run is prepared. */
  variantId: EvalVariantSchema.shape.id.nullable(),
  label: z.string().min(1).max(120),
  prompt: StepVariantPatchSchema.shape.prompt.unwrap(),
  /** How many trials of the source run the reflection read. */
  reflectedOn: z.number().int().nonnegative(),
});

export const EvalOptimisationSchema = EvaluatedStepSchema.extend({
  id: z.uuid(),
  /** The finished Eval Run whose trials the job reflects on. */
  sourceEvalRunId: z.uuid(),
  sourceVariantId: EvalVariantSchema.shape.id,
  /** The source variant's patch; each candidate is this patch with a new `prompt`. */
  basePatch: StepVariantPatchSchema,
  reflectionModel: z.string().min(1),
  candidateCount: z.number().int().min(1).max(3),
  trialsPerCase: z.number().int().min(1).max(10),
  /** What the person granted: the job and the candidates' Eval Run together spend no more. */
  budgetUsd: z.number().positive(),
  /** The reflection calls, at the model registry's price; null until the job ends. */
  jobCostUsd: z.number().nonnegative().nullable(),
  candidates: z.array(OptimisationCandidateSchema),
  evalRunId: z.uuid().nullable(),
  status: EvalOptimisationStatusSchema,
  error: z.string().nullable(),
  createdBy: z.string().min(1),
  createdAt: z.iso.datetime(),
});

export type EvalOptimisationStatus = z.infer<typeof EvalOptimisationStatusSchema>;
export type OptimisationCandidate = z.infer<typeof OptimisationCandidateSchema>;
export type EvalOptimisation = z.infer<typeof EvalOptimisationSchema>;
