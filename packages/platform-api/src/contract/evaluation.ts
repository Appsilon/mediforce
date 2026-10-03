import { z } from 'zod';
import {
  AcceptanceCriteriaSchema,
  AcceptanceCriteriaVersionSchema,
  AgentRunSchema,
  EvalCaseComparisonSchema,
  EvalCaseExpectationSchema,
  EvalCaseInputSchema,
  EvalCaseSchema,
  EvalCaseSplitSchema,
  EvalDatasetVersionSchema,
  EvalOptimisationSchema,
  EvalRunReportSchema,
  EvalRunSchema,
  EvalRunEvaluatorSchema,
  EvalTrialOutcomeSchema,
  EvalTrialSchema,
  EvalTrialStatusSchema,
  EvalVariantSchema,
  JudgeVerdictSchema,
  StoredAgentTrajectoryEntrySchema,
  EvaluatedStepSchema,
  EvaluationBriefSchema,
  EvaluationOriginSchema,
  EvaluatorCheckSchema,
  EvaluatorKindSchema,
  EvaluatorSchema,
  EvaluatorSeveritySchema,
  EvaluatorVersionSchema,
  McpEvalPolicySchema,
  McpEvalServerPolicySchema,
  PerturbedEvalCaseSpecSchema,
  QualificationDeviationSchema,
  ScoreSchema,
  StepFingerprintComponentSchema,
  StepFingerprintSchema,
  StepQualificationSchema,
  StepQualificationStatusSchema,
  StepVariantPatchSchema,
  JudgeReviewDecisionSchema,
  hasPerturbationChange,
} from '@mediforce/platform-core';
import { RegistrationWarningSchema } from './workflows';

/**
 * Contracts for the Evaluation domain (ADR-0023): Evaluation Briefs,
 * Evaluators, Eval Cases, Eval Datasets, MCP eval policies, Acceptance
 * Criteria, Eval Runs and Step Qualifications. Every read and write names the
 * agent Workflow Step it belongs to by `(namespace, workflowName, stepId)`;
 * writes need the workflow's `edit` verb.
 */

/** A query-string boolean. */
const QueryBooleanSchema = z.enum(['true', 'false']).transform((value) => value === 'true');

export const GetEvaluationBriefInputSchema = EvaluatedStepSchema;
export const GetEvaluationBriefOutputSchema = z.object({
  /** The current Brief; null until one is written. */
  brief: EvaluationBriefSchema.nullable(),
  /** Every version, newest first. */
  versions: z.array(EvaluationBriefSchema),
});

export const SetEvaluationBriefInputSchema = EvaluatedStepSchema.extend({
  text: z.string().trim().min(1).max(4000),
  origin: EvaluationOriginSchema.default('user'),
});
export const SetEvaluationBriefOutputSchema = z.object({ brief: EvaluationBriefSchema });

export const EvaluatorTrustSchema = z.object({
  trusted: z.boolean(),
  /** Why it does not count yet; absent when trusted. */
  reason: z.string().optional(),
});

/** Whether an Evaluator scores live Agent Runs now (D13): flagged, not archived, and counted. */
export const EvaluatorProductionSchema = z.object({
  active: z.boolean(),
  /** Why a flagged Evaluator is not running in production yet; absent otherwise. */
  reason: z.string().optional(),
});

/** An Evaluator with its versions and whether its latest version counts (D9): a `code` one once its source is approved. */
export const EvaluatorViewSchema = EvaluatorSchema.extend({
  latest: EvaluatorVersionSchema,
  /** Oldest first. */
  versions: z.array(EvaluatorVersionSchema),
  trust: EvaluatorTrustSchema,
  production: EvaluatorProductionSchema,
});

export const ListEvaluatorsInputSchema = EvaluatedStepSchema.extend({
  includeArchived: QueryBooleanSchema.optional(),
});
export const ListEvaluatorsOutputSchema = z.object({ evaluators: z.array(EvaluatorViewSchema) });

export const GetEvaluatorInputSchema = z.object({ evaluatorId: z.uuid() });
export const EvaluatorOutputSchema = z.object({ evaluator: EvaluatorViewSchema });

export const CreateEvaluatorInputSchema = EvaluatedStepSchema.extend({
  name: EvaluatorSchema.shape.name,
  rule: z.string().trim().min(1).max(2000),
  severity: EvaluatorSeveritySchema,
  check: EvaluatorCheckSchema,
  origin: EvaluationOriginSchema.default('user'),
  runInProduction: z.boolean().optional(),
});

/** A new version: whatever is omitted is carried over from the latest one. */
export const AddEvaluatorVersionInputSchema = z.object({
  evaluatorId: z.uuid(),
  rule: z.string().trim().min(1).max(2000).optional(),
  severity: EvaluatorSeveritySchema.optional(),
  check: EvaluatorCheckSchema.optional(),
  origin: EvaluationOriginSchema.default('user'),
}).refine((input) => input.rule !== undefined || input.severity !== undefined || input.check !== undefined, {
  message: 'A new version changes at least one of rule, severity or check',
});

export const ArchiveEvaluatorInputSchema = z.object({
  evaluatorId: z.uuid(),
  archived: z.boolean().default(true),
});

/** Marks an Evaluator to also score live production Agent Runs of its step (D13). */
export const SetEvaluatorProductionInputSchema = z.object({
  evaluatorId: z.uuid(),
  runInProduction: z.boolean(),
});

/** Records a person's approval of one `code` version's source (D9). */
export const ApproveEvaluatorSourceInputSchema = z.object({
  evaluatorId: z.uuid(),
  version: z.number().int().positive(),
  /** Who approves, for an apiKey caller; a session caller is always itself. */
  uid: z.string().min(1).optional(),
});

/** One check applied to one Agent Run's output. `error` means the check itself failed. */
export const EvaluatorOutcomeSchema = z.object({
  agentRunId: z.string(),
  passed: z.boolean().nullable(),
  value: z.number().min(0).max(1).nullable(),
  label: z.string().nullable(),
  /** An `llm_judge`'s confidence in its verdict; null for other checks. */
  confidence: z.number().min(0).max(1).nullable(),
  /** An `expected_output` agreement judge's score, 0–1; null for other checks and exact comparisons. */
  agreement: z.number().min(0).max(1).nullable(),
  /** The check's comment; an `llm_judge`'s rationale — what decided its verdict and why. */
  comment: z.string().nullable(),
  error: z.string().nullable(),
});

/** Runs a draft check against existing outputs of the Step, writing nothing (D14 `preview_evaluator`). */
export const PreviewEvaluatorInputSchema = EvaluatedStepSchema.extend({
  check: EvaluatorCheckSchema,
  /** Which outputs; defaults to the Step's latest finished production runs. */
  agentRunIds: z.array(z.string().min(1)).min(1).max(20).optional(),
  limit: z.number().int().min(1).max(20).default(5),
});
export const PreviewEvaluatorOutputSchema = z.object({ results: z.array(EvaluatorOutcomeSchema) });

/** The Step's finished production Agent Runs, newest first — dry runs excluded. */
export const ListStepAgentRunsInputSchema = EvaluatedStepSchema.extend({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /** The previous page's `nextCursor`. */
  cursor: z.string().min(1).optional(),
});
export const ListStepAgentRunsOutputSchema = z.object({
  runs: z.array(AgentRunSchema),
  /** Present while older runs remain. */
  nextCursor: z.string().optional(),
});

/** One Agent Run as an input/output pair: what its step was given and what it returned. */
export const GetAgentRunIoInputSchema = z.object({ agentRunId: z.string().min(1) });
export const GetAgentRunIoOutputSchema = z.object({
  agentRunId: z.string(),
  status: AgentRunSchema.shape.status,
  stepInput: z.record(z.string(), z.unknown()).nullable(),
  /** The same input as an Eval Case made from the run holds it: trigger payload, earlier steps' outputs, carry-over. */
  caseInput: EvalCaseInputSchema,
  result: z.unknown(),
  reasoningSummary: z.string().nullable(),
  confidence: z.number().nullable(),
  /** What a person's review makes of `result`: approved is a positive case, rejected a negative one; null when neither. */
  verdictExpectation: EvalCaseExpectationSchema.nullable(),
});

export const ListEvalCasesInputSchema = EvaluatedStepSchema.extend({
  includeArchived: QueryBooleanSchema.optional(),
});
export const ListEvalCasesOutputSchema = z.object({ cases: z.array(EvalCaseSchema) });

export const CreateEvalCaseInputSchema = EvaluatedStepSchema.extend({
  name: z.string().trim().min(1).max(200),
  input: EvalCaseInputSchema,
  workspaceSeedCommit: EvalCaseSchema.shape.workspaceSeedCommit.default(null),
  expectedOutput: EvalCaseSchema.shape.expectedOutput.default(null),
  expectation: EvalCaseExpectationSchema.default('positive'),
  comparison: EvalCaseComparisonSchema.default('exact'),
  agreementInstructions: z.string().trim().max(4000).nullable().default(null),
  evaluatorIds: EvalCaseSchema.shape.evaluatorIds.default(null),
  split: EvalCaseSplitSchema.default('dev'),
  containsProductionData: z.boolean().default(false),
  origin: EvaluationOriginSchema.default('user'),
});

/**
 * "Add to eval set" from a production Agent Run: its input, the outputs before
 * it and its parent commit become the case. A run a person reviewed gives the
 * case its output as the expected output — approved as positive, rejected as
 * negative; an unreviewed run gives none. `expectedOutput` and `expectation`
 * override that. An `input` other than the run's makes a manual case that
 * keeps the run it came from. With `step`, the run must be a run of that step.
 */
export const CreateEvalCaseFromAgentRunInputSchema = z.object({
  agentRunId: z.string().min(1),
  step: EvaluatedStepSchema.optional(),
  name: z.string().trim().min(1).max(200).optional(),
  input: EvalCaseInputSchema.optional(),
  expectedOutput: EvalCaseSchema.shape.expectedOutput.optional(),
  expectation: EvalCaseExpectationSchema.optional(),
  comparison: EvalCaseComparisonSchema.default('exact'),
  agreementInstructions: z.string().trim().max(4000).nullable().default(null),
  evaluatorIds: EvalCaseSchema.shape.evaluatorIds.default(null),
  split: EvalCaseSplitSchema.default('dev'),
  origin: EvaluationOriginSchema.default('user'),
});
export const EvalCaseOutputSchema = z.object({ evalCase: EvalCaseSchema });

/**
 * A case synthesized from a production Agent Run: its input and starting
 * workspace with deliberate changes (a missing or extra file, renamed columns,
 * edge values, an injected instruction). File changes are written as a new
 * commit on the workflow's bare repo, which the case starts from.
 */
export const CreatePerturbedEvalCaseInputSchema = EvaluatedStepSchema
  .extend(PerturbedEvalCaseSpecSchema.shape)
  .extend({
    name: z.string().trim().min(1).max(200),
    expectedOutput: EvalCaseSchema.shape.expectedOutput.default(null),
    comparison: EvalCaseComparisonSchema.default('exact'),
    agreementInstructions: z.string().trim().max(4000).nullable().default(null),
    evaluatorIds: EvalCaseSchema.shape.evaluatorIds.default(null),
    inputChanges: PerturbedEvalCaseSpecSchema.shape.inputChanges.unwrap().default([]),
    fileChanges: PerturbedEvalCaseSpecSchema.shape.fileChanges.unwrap().default([]),
    split: EvalCaseSplitSchema.default('dev'),
    origin: EvaluationOriginSchema.default('user'),
  })
  .refine(hasPerturbationChange, { message: 'give at least one inputChanges or fileChanges entry' });

export const ArchiveEvalCaseInputSchema = z.object({
  caseId: z.uuid(),
  archived: z.boolean().default(true),
});

/**
 * Edits an Eval Case. The edit is a new case that replaces it, and the old one
 * is archived: a frozen Dataset version keeps the case it ran, and the next
 * one freezes the edit.
 */
export const UpdateEvalCaseInputSchema = z.object({
  caseId: z.uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  input: EvalCaseInputSchema.optional(),
  expectedOutput: EvalCaseSchema.shape.expectedOutput.optional(),
  expectation: EvalCaseExpectationSchema.optional(),
  comparison: EvalCaseComparisonSchema.optional(),
  agreementInstructions: z.string().trim().max(4000).nullable().optional(),
  evaluatorIds: EvalCaseSchema.shape.evaluatorIds.optional(),
  split: EvalCaseSplitSchema.optional(),
});

export const ListEvalDatasetsInputSchema = EvaluatedStepSchema;
export const ListEvalDatasetsOutputSchema = z.object({ datasets: z.array(EvalDatasetVersionSchema) });

/** Freezes the Step's live cases (or the named ones) as a new Dataset version. */
export const FreezeEvalDatasetInputSchema = EvaluatedStepSchema.extend({
  caseIds: z.array(z.uuid()).min(1).optional(),
});
export const FreezeEvalDatasetOutputSchema = z.object({ dataset: EvalDatasetVersionSchema });

/** How one of the Step agent's MCP servers behaves in a trial, defaults applied. */
export const EffectiveMcpEvalServerSchema = McpEvalServerPolicySchema.extend({
  name: z.string(),
  /** True when the policy does not name the server and it runs live by default. */
  defaulted: z.boolean(),
  /** The Eval Cases a live trial recorded this server for — the ones a replay can answer. */
  recordedCaseIds: z.array(z.uuid()),
});

export const GetMcpEvalPolicyInputSchema = EvaluatedStepSchema;
export const GetMcpEvalPolicyOutputSchema = z.object({
  policy: McpEvalPolicySchema.nullable(),
  /** Every server the Step's agent binds, as a trial would see it. */
  servers: z.array(EffectiveMcpEvalServerSchema),
});

export const SetMcpEvalPolicyInputSchema = EvaluatedStepSchema.extend({
  servers: z.record(z.string().min(1), McpEvalServerPolicySchema),
});
export const SetMcpEvalPolicyOutputSchema = z.object({ policy: McpEvalPolicySchema });

export const GetAcceptanceCriteriaInputSchema = EvaluatedStepSchema;
export const GetAcceptanceCriteriaOutputSchema = z.object({
  /** The current Acceptance Criteria; null until some are set. */
  criteria: AcceptanceCriteriaVersionSchema.nullable(),
  /** Every version, newest first. */
  versions: z.array(AcceptanceCriteriaVersionSchema),
});

/** Sets the Step's Acceptance Criteria as a new version; the next Eval Run prepared freezes them (D10). */
export const SetAcceptanceCriteriaInputSchema = EvaluatedStepSchema.extend({
  criteria: AcceptanceCriteriaSchema,
  origin: EvaluationOriginSchema.default('user'),
});
export const SetAcceptanceCriteriaOutputSchema = z.object({ criteria: AcceptanceCriteriaVersionSchema });

/** A challenger: the Step with a patch over it (D5), run beside the unpatched champion. */
export const EvalChallengerSchema = z.object({
  label: z.string().trim().min(1).max(120),
  patch: StepVariantPatchSchema,
});

/**
 * Prepares an Eval Run (ADR-0023 D4, D5, D10): freezes the Dataset version (the
 * newest when none is named), the Step's live Evaluator versions, its MCP eval
 * policy, its Acceptance Criteria and Brief version, and the variants — the
 * champion and up to three challengers, each with its Step Fingerprint — and
 * estimates the cost. Nothing runs until `start`.
 */
export const PrepareEvalRunInputSchema = EvaluatedStepSchema.extend({
  /** The Workflow Definition version whose step runs; its runnable version when absent. */
  definitionVersion: z.number().int().positive().optional(),
  datasetVersionId: z.uuid().optional(),
  challengers: z.array(EvalChallengerSchema).max(3).default([]),
  trialsPerCase: z.number().int().min(1).max(10).default(3),
  concurrency: z.number().int().min(1).max(8).default(2),
  /** Spend cap; defaults to 1.5× the estimate, and is required when there is no estimate. */
  budgetUsd: z.number().positive().max(10_000).optional(),
});

/**
 * Starts a prepared Eval Run. `confirmedBudgetUsd` is the person confirming the
 * spend they were shown (D15): it must equal the run's budget. The Evaluation
 * Assistant can prepare a run but never supplies this.
 */
export const StartEvalRunInputSchema = z.object({
  evalRunId: z.uuid(),
  confirmedBudgetUsd: z.number().positive().optional(),
});

export const GetEvalRunInputSchema = z.object({ evalRunId: z.uuid() });
export const CancelEvalRunInputSchema = GetEvalRunInputSchema;

/** An Eval Run with its trials and its report, computed from the Scores its trials received. */
export const EvalRunOutputSchema = z.object({
  evalRun: EvalRunSchema,
  trials: z.array(EvalTrialSchema),
  report: EvalRunReportSchema,
});

export const ListEvalRunsInputSchema = EvaluatedStepSchema;

export const ListEvalRunsOutputSchema = z.object({
  evalRuns: z.array(EvalRunSchema),
});

/** One trial of an Eval Run, with everything its Evaluators read and gave. */
export const GetEvalTrialInputSchema = z.object({ evalRunId: z.uuid(), trialId: z.uuid() });

/** One message as a model judge was sent it. */
export const JudgeMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

/** One Evaluator of the trial's case: what it checks, how it graded the trial, and what its model read. */
export const EvalTrialEvaluatorSchema = z.object({
  evaluator: EvalRunEvaluatorSchema,
  /** The plain-language rule of the Evaluator version frozen into the run — what it looks for; null when that version is gone. */
  rule: z.string().nullable(),
  /** That version's check. */
  check: EvaluatorCheckSchema.nullable(),
  /** Null until the trial is scored. */
  outcome: EvalTrialOutcomeSchema.nullable(),
  /** The Score it gave; null when it gave none. */
  score: z.object({
    value: z.number().min(0).max(1),
    label: z.string().nullable(),
    /** The check's comment; a judge's rationale. */
    comment: z.string().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    minConfidence: z.number().min(0).max(1).nullable(),
    agreement: z.number().min(0).max(1).nullable(),
  }).nullable(),
  /** Why the check could not grade the trial. */
  error: z.string().nullable(),
  /** A person's newest review of a model's verdict. */
  review: JudgeVerdictSchema.shape.review,
  /**
   * What the model was sent — rebuilt from the frozen check and the trial's
   * input, log and output by the function that sent it. Null for a check no
   * model runs, or while there is no output.
   */
  judgePrompt: z.array(JudgeMessageSchema).nullable(),
});

export const GetEvalTrialOutputSchema = z.object({
  trial: EvalTrialSchema,
  variant: EvalVariantSchema,
  /** Null when the case no longer exists. */
  evalCase: EvalCaseSchema.nullable(),
  /** What the step was given; null before the trial has an Agent Run. */
  stepInput: z.record(z.string(), z.unknown()).nullable(),
  result: z.unknown(),
  /** The agent's own summary of what it did. */
  reasoningSummary: z.string().nullable(),
  /** The Agent Run's log, as judges and code checks read it. */
  trajectory: z.array(StoredAgentTrajectoryEntrySchema),
  evaluators: z.array(EvalTrialEvaluatorSchema),
});

/**
 * One variant's failing trials in an Eval Run, the material a fix starts from
 * (ADR-0023 D14): a counted Evaluator failed, a check errored, or the trial
 * failed before producing an Agent Run. `variantId` defaults to the champion.
 */
export const GetEvalRunFailuresInputSchema = z.object({
  evalRunId: z.uuid(),
  variantId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** An Evaluator that failed or could not grade one trial. */
export const TrialEvaluatorFailureSchema = z.object({
  evaluatorId: z.uuid(),
  name: z.string(),
  severity: EvaluatorSeveritySchema,
  kind: EvaluatorKindSchema,
  counted: z.boolean(),
  outcome: z.enum(['failed', 'errored']),
  /** The check's comment on a failed output. */
  comment: z.string().nullable(),
  /** Why the check could not grade it. */
  error: z.string().nullable(),
});

export const EvalTrialFailureSchema = z.object({
  trialId: z.uuid(),
  trialIndex: z.number().int().nonnegative(),
  status: EvalTrialStatusSchema,
  caseId: z.uuid(),
  /** Null when the case no longer exists. */
  caseName: z.string().nullable(),
  split: EvalCaseSplitSchema.nullable(),
  expectation: EvalCaseExpectationSchema.nullable(),
  /** The output the case expects — or, when negative, must not get; null when it has none or no longer exists. */
  expectedOutput: z.unknown().nullable(),
  agentRunId: z.string().nullable(),
  error: z.string().nullable(),
  evaluators: z.array(TrialEvaluatorFailureSchema),
});

/**
 * A person accepts or denies one model's verdict — a judge's, or an
 * expected-output agreement score — on one trial of an Eval Run, after
 * reading its rationale. `accepted` counts it toward the Acceptance
 * Criteria whatever the judge's confidence; `denied` leaves it out — it is
 * never reversed. A later review replaces an earlier one.
 */
export const ReviewJudgeVerdictInputSchema = z.object({
  evalRunId: z.uuid(),
  trialId: z.uuid(),
  evaluatorId: z.uuid(),
  decision: JudgeReviewDecisionSchema,
  comment: z.string().trim().max(2000).optional(),
  /** Who reviews, for an apiKey caller; a session caller is always itself. */
  uid: z.string().min(1).optional(),
});
export const ReviewJudgeVerdictOutputSchema = z.object({ score: ScoreSchema });

export const GetEvalRunFailuresOutputSchema = z.object({
  evalRunId: z.uuid(),
  variantId: z.string(),
  variantLabel: z.string(),
  /** Every failing trial of the variant; `failures` holds the first `limit`. */
  total: z.number().int().nonnegative(),
  failures: z.array(EvalTrialFailureSchema),
});

/**
 * Starts a GEPA optimisation of the Step's prompt (ADR-0023 D15): a container
 * job reflects on one variant's trials of the dev cases in a finished Eval Run
 * — the champion by default — and proposes up to `candidates` prompts, which
 * then run as challengers over the Step's newest Dataset, dev and holdout. The
 * job and that run together spend at most `budgetUsd`, which the person grants
 * with this request. Needs the workflow's `run` verb.
 */
export const StartOptimisationInputSchema = EvaluatedStepSchema.extend({
  evalRunId: z.uuid(),
  variantId: z.string().min(1).optional(),
  budgetUsd: z.number().positive().max(10_000),
  candidates: z.number().int().min(1).max(3).default(3),
  trialsPerCase: z.number().int().min(1).max(10).default(1),
  /** The model GEPA reflects with; the Evaluation Assistant's default when absent. It must have a registry price. */
  reflectionModel: z.string().min(1).optional(),
});

export const GetOptimisationInputSchema = z.object({ optimisationId: z.uuid() });
export const ListOptimisationsInputSchema = EvaluatedStepSchema;
export const ListOptimisationsOutputSchema = z.object({ optimisations: z.array(EvalOptimisationSchema) });

/** One variant's trials of one split's cases: a trial passes when every counted Evaluator graded it and passed it. */
export const OptimisationSplitResultSchema = z.object({
  /** Cases of this split in the Eval Run. */
  cases: z.number().int().nonnegative(),
  /** Trials every counted Evaluator graded. */
  graded: z.number().int().nonnegative(),
  passes: z.number().int().nonnegative(),
  passRate: z.number().min(0).max(1).nullable(),
  wilsonLower: z.number().min(0).max(1).nullable(),
  wilsonUpper: z.number().min(0).max(1).nullable(),
});

export const OptimisationVariantResultSchema = z.object({
  variantId: z.string(),
  label: z.string(),
  /** The prompt it ran with; null for the Step as it is. */
  prompt: z.string().nullable(),
  dev: OptimisationSplitResultSchema,
  holdout: OptimisationSplitResultSchema,
  meanCostUsd: z.number().nonnegative().nullable(),
});

/**
 * An optimisation with its candidates' results, computed from the Scores of
 * its Eval Run when read: the Step as it is as the baseline, and the
 * candidates best first — by the Wilson lower bound of their holdout pass
 * rate, then dev pass rate, then mean cost.
 */
export const EvalOptimisationOutputSchema = z.object({
  optimisation: EvalOptimisationSchema,
  evalRun: EvalRunSchema.pick({ id: true, status: true, budgetUsd: true, spentUsd: true }).nullable(),
  /** The job and the Eval Run together; null while the job's cost is unknown — still proposing, or it died without saying. */
  spentUsd: z.number().nonnegative().nullable(),
  baseline: OptimisationVariantResultSchema.nullable(),
  ranking: z.array(OptimisationVariantResultSchema.extend({ rank: z.number().int().positive() })),
});

/**
 * Applies a variant to the Step (D5): a challenger of one of its Eval Runs, or
 * a patch, over the Step as its runnable version has it, saved as a new
 * Workflow Definition version the way the workflow editor saves one —
 * `setAsDefault` as its save dialog offers. Needs the workflow's `edit` verb.
 */
export const ApplyStepVariantInputSchema = EvaluatedStepSchema.extend({
  evalRunId: z.uuid().optional(),
  variantId: z.string().min(1).optional(),
  patch: StepVariantPatchSchema.optional(),
  setAsDefault: z.boolean().default(false),
}).refine(
  (input) => input.patch === undefined
    ? input.evalRunId !== undefined && input.variantId !== undefined
    : input.evalRunId === undefined && input.variantId === undefined,
  { message: 'give either evalRunId and variantId (a challenger of an Eval Run) or patch' },
);

export const ApplyStepVariantOutputSchema = z.object({
  definitionVersion: z.number().int().positive(),
  /** Whether the new version is the one runs now use: the default, or the newest when none is set. */
  runnable: z.boolean(),
  /** The patched Step's Fingerprint in the new version. */
  fingerprint: StepFingerprintSchema,
  /** The Eval Run variant applied; null for a patch. */
  variant: z.object({
    evalRunId: z.uuid(),
    variantId: z.string(),
    label: z.string(),
    /**
     * The new Fingerprint equals the one frozen with the variant, so a Step
     * Qualification of that variant holds for the new version.
     */
    matchesFingerprint: z.boolean(),
    /** What differs from the variant's Fingerprint; empty when it matches. */
    changed: z.array(StepFingerprintComponentSchema),
  }).nullable(),
  warnings: z.array(RegistrationWarningSchema).optional(),
});

/**
 * The Step's qualification badge (D11). By default for the Step as its
 * runnable version has it; with `definitionVersion`, as that version has it —
 * what a run of that version ran.
 */
export const GetStepQualificationInputSchema = EvaluatedStepSchema.extend({
  definitionVersion: z.coerce.number().int().positive().optional(),
});
/**
 * Whether the step, in this workflow version, is validated: read from the
 * newest finished Eval Run of that version against the criteria frozen into it.
 * `not_verified` when there is none, or when the step's Fingerprint, its
 * Evaluators, its live Eval Cases or its Acceptance Criteria changed since.
 */
export const StepValidationSchema = z.object({
  status: z.enum(['passed', 'failed', 'not_verified']),
  /** The run it is read from; null when no run of the version finished. */
  evalRunId: z.uuid().nullable(),
  /** The run's verdict, or what reset it. */
  reason: z.string(),
  /** An Eval Run of the step is running; the status is read again once it ends. */
  runInProgress: z.boolean(),
});

export const GetStepQualificationOutputSchema = z.object({
  status: StepQualificationStatusSchema,
  validation: StepValidationSchema,
  /** A signed qualification that binds this Fingerprint, else the newest one; null when there is none. */
  qualification: StepQualificationSchema.nullable(),
  definitionVersion: z.number().int().positive(),
  /** The Step's Fingerprint in that version. */
  fingerprint: StepFingerprintSchema,
  /** What differs from the qualified Fingerprint; empty unless stale. */
  changed: z.array(StepFingerprintComponentSchema),
  /**
   * Evaluators added, archived or given a new version since the qualification
   * (D7). A flag, not staleness: the qualification still holds for its Fingerprint.
   */
  evaluatorsChanged: z.array(z.string()),
  /** Every qualification of the Step, newest first. */
  history: z.array(StepQualificationSchema),
});

/** Whether each version of a workflow is verified, one agent step at a time. */
export const GetWorkflowValidationInputSchema = EvaluatedStepSchema.pick({ namespace: true, workflowName: true });

export const StepVersionValidationSchema = z.object({
  stepId: z.string(),
  stepName: z.string(),
  validation: StepValidationSchema,
});

/**
 * One version of the workflow: `passed` (verified) when every agent step's
 * validation in it passed, `failed` when any failed, else `not_verified` —
 * also when it has no agent step.
 */
export const WorkflowVersionValidationSchema = z.object({
  definitionVersion: z.number().int().positive(),
  status: StepValidationSchema.shape.status,
  steps: z.array(StepVersionValidationSchema),
});

/** Every live (not archived) version of the workflow the caller sees, newest first. */
export const GetWorkflowValidationOutputSchema = z.object({ versions: z.array(WorkflowVersionValidationSchema) });

/**
 * Drift alerts: per production Evaluator of the Step, the mean of its newest
 * `window` production Scores against the `window` before them, for its latest
 * version. `window` and `threshold` default to the deployment's settings.
 */
export const GetStepDriftInputSchema = EvaluatedStepSchema.extend({
  window: z.coerce.number().int().min(2).max(500).optional(),
  threshold: z.coerce.number().gt(0).max(1).optional(),
});
export const EvaluatorDriftSchema = z.object({
  evaluatorId: z.string(),
  name: z.string(),
  severity: EvaluatorSeveritySchema,
  evaluatorVersion: z.number().int().positive(),
  /** Mean of the newest `window` Scores; null until there are that many. */
  recentMean: z.number().nullable(),
  /** Mean of the `window` Scores before them; null until there are that many. */
  baselineMean: z.number().nullable(),
  recentCount: z.number().int().nonnegative(),
  baselineCount: z.number().int().nonnegative(),
  /** The mean dropped by at least `threshold`: the alert. */
  drifting: z.boolean(),
});
export const GetStepDriftOutputSchema = z.object({
  window: z.number().int(),
  threshold: z.number(),
  /** Every Evaluator scoring the Step's production runs now, drifting ones first. */
  evaluators: z.array(EvaluatorDriftSchema),
});

/**
 * A person signs a Step Qualification for one variant of a finished Eval Run
 * (D10). Each criterion the variant missed, or that could not be judged,
 * needs a deviation with a written justification. Where password sign-in is
 * enabled, the signer's password re-authenticates them (21 CFR 11.200); an
 * API key cannot sign.
 */
export const SignStepQualificationInputSchema = z.object({
  evalRunId: z.uuid(),
  variantId: z.string().min(1),
  deviations: z.array(QualificationDeviationSchema).default([]),
  password: z.string().min(1).optional(),
});
export const SignStepQualificationOutputSchema = z.object({ qualification: StepQualificationSchema });

export type GetEvaluationBriefInput = z.infer<typeof GetEvaluationBriefInputSchema>;
export type GetEvaluationBriefOutput = z.infer<typeof GetEvaluationBriefOutputSchema>;
export type SetEvaluationBriefInput = z.input<typeof SetEvaluationBriefInputSchema>;
export type SetEvaluationBriefOutput = z.infer<typeof SetEvaluationBriefOutputSchema>;
export type EvaluatorView = z.infer<typeof EvaluatorViewSchema>;
export type ListEvaluatorsInput = z.input<typeof ListEvaluatorsInputSchema>;
export type ListEvaluatorsOutput = z.infer<typeof ListEvaluatorsOutputSchema>;
export type GetEvaluatorInput = z.infer<typeof GetEvaluatorInputSchema>;
export type EvaluatorOutput = z.infer<typeof EvaluatorOutputSchema>;
export type CreateEvaluatorInput = z.input<typeof CreateEvaluatorInputSchema>;
export type AddEvaluatorVersionInput = z.input<typeof AddEvaluatorVersionInputSchema>;
export type ArchiveEvaluatorInput = z.input<typeof ArchiveEvaluatorInputSchema>;
export type SetEvaluatorProductionInput = z.infer<typeof SetEvaluatorProductionInputSchema>;
export type EvaluatorProduction = z.infer<typeof EvaluatorProductionSchema>;
export type ApproveEvaluatorSourceInput = z.infer<typeof ApproveEvaluatorSourceInputSchema>;
export type EvaluatorOutcome = z.infer<typeof EvaluatorOutcomeSchema>;
export type PreviewEvaluatorInput = z.input<typeof PreviewEvaluatorInputSchema>;
export type PreviewEvaluatorOutput = z.infer<typeof PreviewEvaluatorOutputSchema>;
export type ListStepAgentRunsInput = z.input<typeof ListStepAgentRunsInputSchema>;
export type ListStepAgentRunsOutput = z.infer<typeof ListStepAgentRunsOutputSchema>;
export type GetAgentRunIoInput = z.input<typeof GetAgentRunIoInputSchema>;
export type GetAgentRunIoOutput = z.infer<typeof GetAgentRunIoOutputSchema>;
export type ListEvalCasesInput = z.input<typeof ListEvalCasesInputSchema>;
export type ListEvalCasesOutput = z.infer<typeof ListEvalCasesOutputSchema>;
export type CreateEvalCaseInput = z.input<typeof CreateEvalCaseInputSchema>;
export type CreateEvalCaseFromAgentRunInput = z.input<typeof CreateEvalCaseFromAgentRunInputSchema>;
export type EvalCaseOutput = z.infer<typeof EvalCaseOutputSchema>;
export type CreatePerturbedEvalCaseInput = z.input<typeof CreatePerturbedEvalCaseInputSchema>;
export type ArchiveEvalCaseInput = z.input<typeof ArchiveEvalCaseInputSchema>;
export type UpdateEvalCaseInput = z.input<typeof UpdateEvalCaseInputSchema>;
export type ListEvalDatasetsInput = z.infer<typeof ListEvalDatasetsInputSchema>;
export type ListEvalDatasetsOutput = z.infer<typeof ListEvalDatasetsOutputSchema>;
export type FreezeEvalDatasetInput = z.infer<typeof FreezeEvalDatasetInputSchema>;
export type FreezeEvalDatasetOutput = z.infer<typeof FreezeEvalDatasetOutputSchema>;
export type GetMcpEvalPolicyInput = z.infer<typeof GetMcpEvalPolicyInputSchema>;
export type GetMcpEvalPolicyOutput = z.infer<typeof GetMcpEvalPolicyOutputSchema>;
export type SetMcpEvalPolicyInput = z.infer<typeof SetMcpEvalPolicyInputSchema>;
export type SetMcpEvalPolicyOutput = z.infer<typeof SetMcpEvalPolicyOutputSchema>;
export type PrepareEvalRunInput = z.input<typeof PrepareEvalRunInputSchema>;
export type StartEvalRunInput = z.infer<typeof StartEvalRunInputSchema>;
export type GetEvalRunInput = z.infer<typeof GetEvalRunInputSchema>;
export type CancelEvalRunInput = z.infer<typeof CancelEvalRunInputSchema>;
export type EvalRunOutput = z.infer<typeof EvalRunOutputSchema>;
export type ListEvalRunsInput = z.infer<typeof ListEvalRunsInputSchema>;
export type ListEvalRunsOutput = z.infer<typeof ListEvalRunsOutputSchema>;
export type GetEvalTrialInput = z.infer<typeof GetEvalTrialInputSchema>;
export type GetEvalTrialOutput = z.infer<typeof GetEvalTrialOutputSchema>;
export type EvalTrialEvaluator = z.infer<typeof EvalTrialEvaluatorSchema>;
export type JudgeMessage = z.infer<typeof JudgeMessageSchema>;
export type GetEvalRunFailuresInput = z.input<typeof GetEvalRunFailuresInputSchema>;
export type GetEvalRunFailuresOutput = z.infer<typeof GetEvalRunFailuresOutputSchema>;
export type EvalTrialFailure = z.infer<typeof EvalTrialFailureSchema>;
export type TrialEvaluatorFailure = z.infer<typeof TrialEvaluatorFailureSchema>;
export type ReviewJudgeVerdictInput = z.infer<typeof ReviewJudgeVerdictInputSchema>;
export type ReviewJudgeVerdictOutput = z.infer<typeof ReviewJudgeVerdictOutputSchema>;
export type ApplyStepVariantInput = z.input<typeof ApplyStepVariantInputSchema>;
export type ApplyStepVariantOutput = z.infer<typeof ApplyStepVariantOutputSchema>;
export type GetAcceptanceCriteriaInput = z.infer<typeof GetAcceptanceCriteriaInputSchema>;
export type GetAcceptanceCriteriaOutput = z.infer<typeof GetAcceptanceCriteriaOutputSchema>;
export type SetAcceptanceCriteriaInput = z.input<typeof SetAcceptanceCriteriaInputSchema>;
export type SetAcceptanceCriteriaOutput = z.infer<typeof SetAcceptanceCriteriaOutputSchema>;
export type EvalChallenger = z.infer<typeof EvalChallengerSchema>;
export type GetStepQualificationInput = z.input<typeof GetStepQualificationInputSchema>;
export type GetStepQualificationOutput = z.infer<typeof GetStepQualificationOutputSchema>;
export type StepValidation = z.infer<typeof StepValidationSchema>;
export type GetWorkflowValidationInput = z.infer<typeof GetWorkflowValidationInputSchema>;
export type GetWorkflowValidationOutput = z.infer<typeof GetWorkflowValidationOutputSchema>;
export type WorkflowVersionValidation = z.infer<typeof WorkflowVersionValidationSchema>;
export type SignStepQualificationInput = z.input<typeof SignStepQualificationInputSchema>;
export type SignStepQualificationOutput = z.infer<typeof SignStepQualificationOutputSchema>;
export type GetStepDriftInput = z.input<typeof GetStepDriftInputSchema>;
export type GetStepDriftOutput = z.infer<typeof GetStepDriftOutputSchema>;
export type EvaluatorDrift = z.infer<typeof EvaluatorDriftSchema>;
export type StartOptimisationInput = z.input<typeof StartOptimisationInputSchema>;
export type GetOptimisationInput = z.infer<typeof GetOptimisationInputSchema>;
export type ListOptimisationsInput = z.infer<typeof ListOptimisationsInputSchema>;
export type ListOptimisationsOutput = z.infer<typeof ListOptimisationsOutputSchema>;
export type OptimisationSplitResult = z.infer<typeof OptimisationSplitResultSchema>;
export type OptimisationVariantResult = z.infer<typeof OptimisationVariantResultSchema>;
export type EvalOptimisationOutput = z.infer<typeof EvalOptimisationOutputSchema>;
