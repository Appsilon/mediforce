import { z } from 'zod';
import { EvaluatedStepSchema, EvaluatorKindSchema, EvaluatorSeveritySchema, McpEvalServerPolicySchema } from './evaluation';

/**
 * An Eval Run (ADR-0023 D4, D10): one variant of a Step — in phase 1b the Step
 * as its pinned Definition version has it — run over a frozen Eval Dataset
 * version, `trialsPerCase` times per case. Each trial is a real single-step
 * Workflow Run flagged with the Eval Run's id.
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

export const EvalRunEstimateSchema = z.object({
  /** null when neither the Step's history nor model pricing gives a number. */
  perTrialUsd: z.number().nonnegative().nullable(),
  totalUsd: z.number().nonnegative().nullable(),
  /** `history`: mean cost of the Step's recent production runs; `model_pricing`: registry price × a nominal token budget. */
  basis: z.enum(['history', 'model_pricing', 'unknown']),
  sampleSize: z.number().int().nonnegative(),
});

export const EvalRunSchema = EvaluatedStepSchema.extend({
  id: z.uuid(),
  definitionVersion: z.number().int().positive(),
  datasetVersionId: z.uuid(),
  caseIds: z.array(z.uuid()).min(1),
  trialsPerCase: z.number().int().min(1).max(10),
  concurrency: z.number().int().min(1).max(8),
  evaluators: z.array(EvalRunEvaluatorSchema).min(1),
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
  trialIndex: z.number().int().nonnegative(),
  status: EvalTrialStatusSchema,
  processInstanceId: z.string().nullable(),
  agentRunId: z.string().nullable(),
  /** The Agent Run's cost plus the LLM judge calls that scored it. */
  costUsd: z.number().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  /** Why the trial failed or was skipped, or which Evaluators could not run. */
  error: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  /** When a driver claimed it for scoring; a stale claim is taken over. */
  scoringStartedAt: z.iso.datetime().nullable(),
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

export const EvalRunReportSchema = z.object({
  k: z.number().int().positive(),
  trials: z.object({
    total: z.number().int().nonnegative(),
    scored: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    inProgress: z.number().int().nonnegative(),
  }),
  evaluators: z.array(EvalRunEvaluatorReportSchema),
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
export type EvalRunEvaluatorReport = z.infer<typeof EvalRunEvaluatorReportSchema>;
export type EvalRunReport = z.infer<typeof EvalRunReportSchema>;
