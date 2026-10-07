import { z } from 'zod';
import {
  AcceptanceCriteriaSchema,
  EvaluatedStepSchema,
  EvaluatorKindSchema,
  McpEvalServerPolicySchema,
  McpReplayMissSchema,
  StoredAcceptanceCriteriaSchema,
} from './evaluation';

/**
 * An Eval Run (ADR-0023 D4, D5, D10): a Step, as its pinned Definition version
 * has it, run over a frozen Eval Dataset version, `trialsPerCase` times per
 * case. Each trial is a real single-step Workflow Run flagged with the
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
  counted: z.boolean(),
  /** Why it does not count, when it does not. */
  reason: z.string().optional(),
});

const EstimateBasisSchema = z.enum(['history', 'model_pricing', 'unknown']);

export const EvalRunEstimateSchema = z.object({
  /** Per trial; null when neither the Step's history nor model pricing gives a number. */
  perTrialUsd: z.number().nonnegative().nullable(),
  totalUsd: z.number().nonnegative().nullable(),
  /**
   * `history`, the mean cost of the Step's recent production runs;
   * `model_pricing`, its model's registry price × a nominal token budget.
   */
  basis: EstimateBasisSchema,
  sampleSize: z.number().int().nonnegative(),
});

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

/**
 * How an Eval Run fared on the Acceptance Criteria frozen into it:
 * `met` every one, `missed` one, `not_judged` none missed but one not judged,
 * `no_criteria` none were frozen.
 */
export const EvalRunAcceptanceSchema = z.object({
  status: z.enum(['met', 'missed', 'not_judged', 'no_criteria']),
  reason: z.string(),
});

export const EvalRunSchema = EvaluatedStepSchema.extend({
  id: z.uuid(),
  definitionVersion: z.number().int().positive(),
  datasetVersionId: z.uuid(),
  caseIds: z.array(z.uuid()).min(1),
  trialsPerCase: z.number().int().min(1).max(10),
  concurrency: z.number().int().min(1).max(8),
  evaluators: z.array(EvalRunEvaluatorSchema).min(1),
  /** The Step's Fingerprint when the run was prepared; null on runs prepared before Fingerprints. */
  fingerprint: StepFingerprintSchema.nullable(),
  /** Frozen at prepare (D10); null when the Step had none, and then the report judges nothing. */
  acceptanceCriteria: StoredAcceptanceCriteriaSchema.nullable(),
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
  /** Written when the run finishes and whenever a late trial or a judge review changes it; null until then. */
  acceptance: EvalRunAcceptanceSchema.nullable(),
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

/** One call a check made to its model: what it answered, what it spent and how long it took. */
export const JudgeCallSchema = z.object({
  model: z.string(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  durationMs: z.number(),
  /** The model's answer, as it gave it. */
  response: z.string(),
});

export const EvalTrialSchema = z.object({
  id: z.uuid(),
  evalRunId: z.uuid(),
  caseId: z.uuid(),
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
  /** Calls to a replayed MCP server that no recording answered (D6). */
  mcpReplayMisses: z.array(McpReplayMissSchema),
  /** By Evaluator id, the model calls of a check that gave no Score — what its model answered instead of a verdict. */
  erroredJudgeCalls: z.record(z.string(), z.array(JudgeCallSchema)),
});

/** One Evaluator's result over the whole run (D10). Rates are over graded trials; null when none were. */
export const EvalRunEvaluatorReportSchema = EvalRunEvaluatorSchema.extend({
  passes: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  /** Trials the check could not grade; not in the rate. */
  errors: z.number().int().nonnegative(),
  /** Model verdicts left out of the rate: a judge's below its `minConfidence` and not accepted by a person, or any denied by one. */
  excluded: z.number().int().nonnegative(),
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

/** How the Acceptance Criteria fared (D10). */
export const AcceptanceCriterionVerdictSchema = z.object({
  criterion: AcceptanceCriteriaSchema,
  /** `not_evaluable`: no counted Evaluator, or one that graded no trial. */
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
 * What the report recommends for the Step's routing: `L4` (Control Mode 4,
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

/**
 * How the trials reached the Step's MCP servers (D6): each server by the mode
 * it ran in, how many cases a replayed server ran live to record because none
 * had a recording yet, and the calls to a replayed server no recording
 * answered. With no server `live` and none recorded first, no trial made a
 * live MCP call.
 */
export const EvalRunMcpReportSchema = z.object({
  live: z.array(z.string()),
  replayed: z.array(z.string()),
  denied: z.array(z.string()),
  recordedFirst: z.array(z.object({
    server: z.string(),
    cases: z.number().int().positive(),
  })),
  unrecordedCalls: z.array(z.object({
    server: z.string(),
    tool: z.string(),
    count: z.number().int().positive(),
  })),
});

/** A person's review of one judge verdict: `accepted` counts it, `denied` leaves it out. Neither reverses it. */
export const JudgeReviewDecisionSchema = z.enum(['accepted', 'denied']);

/**
 * One model's verdict on one trial, as a person reviews it — a judge's, or an
 * expected-output agreement score: pass or fail, how confident the judge was
 * or how far the output agreed, and its rationale — what decided the verdict and why.
 */
export const JudgeVerdictSchema = z.object({
  trialId: z.uuid(),
  trialIndex: z.number().int().nonnegative(),
  caseId: z.uuid(),
  /** Null when the case no longer exists. */
  caseName: z.string().nullable(),
  agentRunId: z.string(),
  evaluatorId: z.uuid(),
  name: z.string(),
  /** The judge's Score. */
  scoreId: z.uuid(),
  passed: z.boolean(),
  /** Null on verdicts recorded before judges reported a confidence. */
  confidence: z.number().min(0).max(1).nullable(),
  minConfidence: z.number().min(0).max(1).nullable(),
  /** An expected-output check's agreement score; null on a judge's verdict. */
  agreement: z.number().min(0).max(1).nullable(),
  rationale: z.string().nullable(),
  review: z.object({
    decision: JudgeReviewDecisionSchema,
    reviewedBy: z.string().nullable(),
    reviewedAt: z.iso.datetime(),
    comment: z.string().nullable(),
  }).nullable(),
  /** Whether it counts toward the Acceptance Criteria. */
  counts: z.boolean(),
});

/**
 * How one Evaluator graded one trial: `excluded`, a model verdict left out of
 * the criteria (`EvalRunEvaluatorReportSchema.excluded`); `errored`, the check
 * could not grade it.
 */
export const EvalTrialOutcomeSchema = z.enum(['pass', 'fail', 'excluded', 'errored']);

/** One trial as graded by every Evaluator its case selects; none until it is scored. */
export const EvalTrialResultSchema = z.object({
  trialId: z.uuid(),
  /** Null when the case no longer exists. */
  caseName: z.string().nullable(),
  /** Whether every counted Evaluator graded it and passed it; null when one did not grade it or none counts. */
  passed: z.boolean().nullable(),
  evaluators: z.array(z.object({
    evaluatorId: z.uuid(),
    outcome: EvalTrialOutcomeSchema,
    /** The check's comment or a judge's rationale; null when it gave none. */
    comment: z.string().nullable(),
  })),
});

/** An Eval Run's results: its Evaluators, criteria, confidence calibration, what it cost, and every verdict and grade. */
export const EvalRunReportSchema = z.object({
  k: z.number().int().positive(),
  trials: TrialCountsSchema,
  mcp: EvalRunMcpReportSchema,
  evaluators: z.array(EvalRunEvaluatorReportSchema),
  /** The verdict on the run's Acceptance Criteria; null when the run has none. */
  criteriaVerdict: AcceptanceCriterionVerdictSchema.nullable(),
  confidence: ConfidenceCalibrationSchema.nullable(),
  recommendation: ControlRecommendationSchema.nullable(),
  /** Every model's verdict on a scored trial — judges' and agreement scores — by case and trial. */
  judgeVerdicts: z.array(JudgeVerdictSchema),
  /** Every trial's grades, by case and trial. */
  trialResults: z.array(EvalTrialResultSchema),
  costUsd: z.number().nonnegative(),
  meanCostUsd: z.number().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  meanDurationMs: z.number().nonnegative().nullable(),
  maxDurationMs: z.number().nonnegative().nullable(),
});

export type EvalRunStatus = z.infer<typeof EvalRunStatusSchema>;
export type EvalRunEvaluator = z.infer<typeof EvalRunEvaluatorSchema>;
export type EvalRunEstimate = z.infer<typeof EvalRunEstimateSchema>;
export type EvalRun = z.infer<typeof EvalRunSchema>;
export type EvalTrialStatus = z.infer<typeof EvalTrialStatusSchema>;
export type EvalTrial = z.infer<typeof EvalTrialSchema>;
export type JudgeCall = z.infer<typeof JudgeCallSchema>;
export type EvalRunEvaluatorReport = z.infer<typeof EvalRunEvaluatorReportSchema>;
export type EvalRunReport = z.infer<typeof EvalRunReportSchema>;
export type EvalRunMcpReport = z.infer<typeof EvalRunMcpReportSchema>;
export type StepFingerprintComponent = z.infer<typeof StepFingerprintComponentSchema>;
export type StepFingerprint = z.infer<typeof StepFingerprintSchema>;
export type AcceptanceCriterionVerdict = z.infer<typeof AcceptanceCriterionVerdictSchema>;
export type ConfidenceCalibration = z.infer<typeof ConfidenceCalibrationSchema>;
export type ControlRecommendation = z.infer<typeof ControlRecommendationSchema>;
export type JudgeReviewDecision = z.infer<typeof JudgeReviewDecisionSchema>;
export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;
export type EvalTrialOutcome = z.infer<typeof EvalTrialOutcomeSchema>;
export type EvalTrialResult = z.infer<typeof EvalTrialResultSchema>;
export type EvalRunAcceptance = z.infer<typeof EvalRunAcceptanceSchema>;
