import { z } from 'zod';
import {
  AcceptanceCriteriaSchema,
  AcceptanceCriterionSchema,
  EvaluatedStepSchema,
  EvaluatorKindSchema,
  EvaluatorSeveritySchema,
  McpEvalServerPolicySchema,
  StepVariantPatchSchema,
} from './evaluation';

/**
 * An Eval Run (ADR-0023 D4, D5, D10): variants of a Step — the champion, the
 * Step as its pinned Definition version has it, and challengers patched over
 * it — run over a frozen Eval Dataset version, `trialsPerCase` times per case
 * and variant. Each trial is a real single-step Workflow Run flagged with the
 * Eval Run's id.
 */
export const EvalRunStatusSchema = z.enum([
  /** Created with its estimate; waits for a person to confirm the budget. */
  'prepared',
  'running',
  'completed',
  /** Stopped starting trials once spend reached the budget; the rest are skipped. */
  'budget_exceeded',
  'cancelled',
]);

/** One Evaluator version as frozen into the run, and whether it counts (D9). */
export const EvalRunEvaluatorSchema = z.object({
  evaluatorId: z.uuid(),
  name: z.string(),
  version: z.number().int().positive(),
  kind: EvaluatorKindSchema,
  severity: EvaluatorSeveritySchema,
  counted: z.boolean(),
  /** Why it does not count, when it does not. */
  reason: z.string().optional(),
});

const EstimateBasisSchema = z.enum(['history', 'model_pricing', 'unknown']);

export const EvalRunEstimateSchema = z.object({
  /** Mean over all trials; null when neither the Step's history nor model pricing gives a number for every variant. */
  perTrialUsd: z.number().nonnegative().nullable(),
  totalUsd: z.number().nonnegative().nullable(),
  /**
   * The champion's: `history`, the mean cost of the Step's recent production
   * runs; `model_pricing`, its model's registry price × a nominal token budget.
   */
  basis: EstimateBasisSchema,
  sampleSize: z.number().int().nonnegative(),
  /**
   * Per variant. A challenger on another model is priced at that model for the
   * tokens the Step's runs used. Absent on runs prepared before variants.
   */
  variants: z.array(z.object({
    variantId: z.string(),
    perTrialUsd: z.number().nonnegative().nullable(),
    basis: EstimateBasisSchema,
  })).optional(),
});

/** The variant every Eval Run has: the Step unpatched, the baseline challengers are compared against. */
export const CHAMPION_VARIANT_ID = 'champion';

/** A SHA-256, hex. */
export const StepFingerprintHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * The parts of a Step that a Step Fingerprint covers (ADR-0023 D5), each
 * hashed on its own so two Fingerprints can say what differs.
 */
export const STEP_FINGERPRINT_COMPONENTS = [
  'step',
  'model',
  'systemPrompt',
  'skill',
  'image',
  'mcpServers',
  'preamble',
] as const;

export const StepFingerprintComponentSchema = z.enum(STEP_FINGERPRINT_COMPONENTS);

/** A Step Fingerprint: the hash of its components' hashes, and the components. */
export const StepFingerprintSchema = z.object({
  hash: StepFingerprintHashSchema,
  components: z.record(StepFingerprintComponentSchema, StepFingerprintHashSchema),
});

export const EvalVariantSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  label: z.string().min(1).max(120),
  patch: StepVariantPatchSchema,
  /** The patched Step's Fingerprint when the run was prepared; null on runs prepared before Fingerprints. */
  fingerprint: StepFingerprintSchema.nullable(),
});

export const EvalRunSchema = EvaluatedStepSchema.extend({
  id: z.uuid(),
  definitionVersion: z.number().int().positive(),
  datasetVersionId: z.uuid(),
  caseIds: z.array(z.uuid()).min(1),
  trialsPerCase: z.number().int().min(1).max(10),
  concurrency: z.number().int().min(1).max(8),
  evaluators: z.array(EvalRunEvaluatorSchema).min(1),
  /** The champion first, then the challengers. */
  variants: z.array(EvalVariantSchema).min(1),
  /** Frozen at prepare (D10); null when the Step had none, and then the report judges nothing. */
  acceptanceCriteria: AcceptanceCriteriaSchema.nullable(),
  /** The Evaluation Brief version in force at prepare — the context of use a Step Qualification cites. */
  briefVersion: z.number().int().positive().nullable(),
  /** The MCP eval policy the trials ran under, one entry per server of the Step's agent (D6). */
  mcpPolicy: z.record(z.string(), McpEvalServerPolicySchema),
  estimate: EvalRunEstimateSchema,
  /** Spend cap: no trial starts once `spentUsd` reaches it. */
  budgetUsd: z.number().positive(),
  spentUsd: z.number().nonnegative(),
  status: EvalRunStatusSchema,
  createdBy: z.string().min(1),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
});

export const EvalTrialStatusSchema = z.enum([
  'pending',
  'running',
  /** Its run finished; Evaluators are being applied. */
  'scoring',
  'scored',
  /** The trial produced nothing to score (the run failed before an Agent Run). */
  'failed',
  /** Never started — the budget ran out or the run was cancelled. */
  'skipped',
]);

export const EvalTrialSchema = z.object({
  id: z.uuid(),
  evalRunId: z.uuid(),
  caseId: z.uuid(),
  variantId: EvalVariantSchema.shape.id,
  trialIndex: z.number().int().nonnegative(),
  status: EvalTrialStatusSchema,
  processInstanceId: z.string().nullable(),
  agentRunId: z.string().nullable(),
  /** The Agent Run's cost plus the LLM judge calls that scored it. */
  costUsd: z.number().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  /** The confidence the agent reported for its output, when it reported one. */
  confidence: z.number().min(0).max(1).nullable(),
  /** Why the trial failed or was skipped, or which Evaluators could not run. */
  error: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  /** When a driver claimed it for scoring; a stale claim is taken over. */
  scoringStartedAt: z.iso.datetime().nullable(),
  /** How many drivers have claimed it for scoring. */
  scoringAttempts: z.number().int().nonnegative(),
  completedAt: z.iso.datetime().nullable(),
});

/** One Evaluator's result over the whole run (D10). Rates are over graded trials; null when none were. */
export const EvalRunEvaluatorReportSchema = EvalRunEvaluatorSchema.extend({
  passes: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  /** Trials the check could not grade; not in the rate. */
  errors: z.number().int().nonnegative(),
  passRate: z.number().min(0).max(1).nullable(),
  /** Wilson 95% interval on the pass rate. */
  wilsonLower: z.number().min(0).max(1).nullable(),
  wilsonUpper: z.number().min(0).max(1).nullable(),
  /** Share of cases where at least one of its k trials passed. */
  passAtK: z.number().min(0).max(1).nullable(),
  /** Share of cases where all k trials passed (τ-bench pass^k). */
  passHatK: z.number().min(0).max(1).nullable(),
  /** Share of cases whose trials disagreed with each other. */
  flakiness: z.number().min(0).max(1).nullable(),
});

/** How one Acceptance Criterion fared for one variant (D10). */
export const AcceptanceCriterionVerdictSchema = z.object({
  severity: EvaluatorSeveritySchema,
  criterion: AcceptanceCriterionSchema,
  /** `not_evaluable`: no counted Evaluator of this severity, or one that graded no trial. */
  status: z.enum(['met', 'missed', 'not_evaluable']),
  evaluators: z.array(z.object({
    evaluatorId: z.uuid(),
    name: z.string(),
    wilsonLower: z.number().min(0).max(1).nullable(),
    passHatK: z.number().min(0).max(1).nullable(),
    met: z.boolean().nullable(),
  })),
  /** What decided it, in words. */
  reason: z.string(),
});

/**
 * Agent-reported confidence against whether the output passed every counted
 * Evaluator that graded it: the reliability curve in equal-width bins and its
 * expected calibration error.
 */
export const ConfidenceCalibrationSchema = z.object({
  /** Graded trials that reported a confidence. */
  count: z.number().int().nonnegative(),
  bins: z.array(z.object({
    lower: z.number().min(0).max(1),
    upper: z.number().min(0).max(1),
    count: z.number().int().positive(),
    meanConfidence: z.number().min(0).max(1),
    passRate: z.number().min(0).max(1),
  })),
  /** Expected calibration error: the count-weighted gap between confidence and pass rate. */
  ece: z.number().min(0).max(1),
});

/**
 * What the report recommends for the variant's routing: `L4` (Control Mode 4,
 * the agent applies its output) above a `confidenceThreshold`, below which the
 * step's fallback sends it to a person — or `L3` (Control Mode 3), a person
 * reviews every output. Control Mode itself is presentational (ADR-0014).
 */
export const ControlRecommendationSchema = z.object({
  autonomyLevel: z.enum(['L3', 'L4']),
  confidenceThreshold: z.number().min(0).max(1).nullable(),
  /** Share of graded trials at or above the threshold — what would run without a person. */
  coverage: z.number().min(0).max(1).nullable(),
  reason: z.string(),
});

const TrialCountsSchema = z.object({
  total: z.number().int().nonnegative(),
  scored: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
});

/** One variant's results: its Evaluators, criteria, confidence calibration and what it cost. */
export const EvalRunVariantReportSchema = EvalVariantSchema.extend({
  trials: TrialCountsSchema,
  evaluators: z.array(EvalRunEvaluatorReportSchema),
  /** One verdict per severity the run's criteria set; empty when the run has none. */
  criteria: z.array(AcceptanceCriterionVerdictSchema),
  confidence: ConfidenceCalibrationSchema.nullable(),
  recommendation: ControlRecommendationSchema.nullable(),
  costUsd: z.number().nonnegative(),
  meanCostUsd: z.number().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  meanDurationMs: z.number().nonnegative().nullable(),
  maxDurationMs: z.number().nonnegative().nullable(),
});

/**
 * One challenger against the champion. Per Evaluator, `better` or `worse` only
 * when the two Wilson 95% intervals do not overlap — at an Eval Run's small n,
 * anything less is no clear difference.
 */
export const VariantComparisonSchema = z.object({
  variantId: z.string(),
  evaluators: z.array(z.object({
    evaluatorId: z.uuid(),
    name: z.string(),
    championPassRate: z.number().min(0).max(1).nullable(),
    challengerPassRate: z.number().min(0).max(1).nullable(),
    delta: z.number().min(-1).max(1).nullable(),
    verdict: z.enum(['better', 'worse', 'no_clear_difference']),
  })),
  meanCostDeltaUsd: z.number().nullable(),
  meanDurationDeltaMs: z.number().nullable(),
});

export const EvalRunReportSchema = z.object({
  k: z.number().int().positive(),
  trials: TrialCountsSchema,
  /** The champion first, then the challengers, as the run froze them. */
  variants: z.array(EvalRunVariantReportSchema),
  /** Every challenger against the champion. */
  comparison: z.array(VariantComparisonSchema),
  costUsd: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});

export type EvalRunStatus = z.infer<typeof EvalRunStatusSchema>;
export type EvalRunEvaluator = z.infer<typeof EvalRunEvaluatorSchema>;
export type EvalRunEstimate = z.infer<typeof EvalRunEstimateSchema>;
export type EvalRun = z.infer<typeof EvalRunSchema>;
export type EvalTrialStatus = z.infer<typeof EvalTrialStatusSchema>;
export type EvalTrial = z.infer<typeof EvalTrialSchema>;
export type EvalRunEvaluatorReport = z.infer<typeof EvalRunEvaluatorReportSchema>;
export type EvalRunReport = z.infer<typeof EvalRunReportSchema>;
export type EvalVariant = z.infer<typeof EvalVariantSchema>;
export type StepFingerprintComponent = z.infer<typeof StepFingerprintComponentSchema>;
export type StepFingerprint = z.infer<typeof StepFingerprintSchema>;
export type AcceptanceCriterionVerdict = z.infer<typeof AcceptanceCriterionVerdictSchema>;
export type ConfidenceCalibration = z.infer<typeof ConfidenceCalibrationSchema>;
export type ControlRecommendation = z.infer<typeof ControlRecommendationSchema>;
export type EvalRunVariantReport = z.infer<typeof EvalRunVariantReportSchema>;
export type VariantComparison = z.infer<typeof VariantComparisonSchema>;
