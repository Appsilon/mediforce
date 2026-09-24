import { z } from 'zod';
import {
  AgentRunSchema,
  EvalCaseExpectationSchema,
  EvalCaseInputSchema,
  EvalCaseSchema,
  EvalCaseSplitSchema,
  EvalDatasetVersionSchema,
  EvalRunReportSchema,
  EvalRunSchema,
  EvalTrialSchema,
  EvaluatedStepSchema,
  EvaluationBriefSchema,
  EvaluationOriginSchema,
  EvaluatorCheckSchema,
  EvaluatorSchema,
  EvaluatorSeveritySchema,
  EvaluatorVersionSchema,
  McpEvalPolicySchema,
  McpEvalServerPolicySchema,
  PerturbedEvalCaseSpecSchema,
  ScoreSchema,
  hasPerturbationChange,
} from '@mediforce/platform-core';

/**
 * Contracts for the Evaluation domain (ADR-0023): Evaluation Briefs,
 * Evaluators, Eval Cases, Eval Datasets and MCP eval policies. Every read and
 * write names the agent Workflow Step it belongs to by
 * `(namespace, workflowName, stepId)`; writes need the workflow's `edit` verb.
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

/** An Evaluator with its versions and whether its latest version counts (D9). */
export const EvaluatorViewSchema = EvaluatorSchema.extend({
  latest: EvaluatorVersionSchema,
  /** Oldest first. */
  versions: z.array(EvaluatorVersionSchema),
  trust: EvaluatorTrustSchema,
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

/** Records a person's approval of one `code` version's source (D9). */
export const ApproveEvaluatorSourceInputSchema = z.object({
  evaluatorId: z.uuid(),
  version: z.number().int().positive(),
  /** Who approves, for an apiKey caller; a session caller is always itself. */
  uid: z.string().min(1).optional(),
});

/** A human label on one Agent Run's output for this Evaluator, the ground truth a judge is calibrated against. */
export const LabelEvaluatorOutputInputSchema = z.object({
  evaluatorId: z.uuid(),
  agentRunId: z.string().min(1),
  passed: z.boolean(),
  comment: z.string().trim().max(2000).optional(),
  uid: z.string().min(1).optional(),
});
export const LabelEvaluatorOutputOutputSchema = z.object({ score: ScoreSchema });

/** The person's labels on this Evaluator's outputs — the newest per Agent Run, newest first. */
export const ListEvaluatorLabelsInputSchema = z.object({ evaluatorId: z.uuid() });
export const ListEvaluatorLabelsOutputSchema = z.object({ labels: z.array(ScoreSchema) });

export const CalibrateEvaluatorInputSchema = z.object({
  evaluatorId: z.uuid(),
  /** Defaults to the latest version. */
  version: z.number().int().positive().optional(),
});
export const CalibrateEvaluatorOutputSchema = z.object({
  evaluator: EvaluatorViewSchema,
  /** Labelled runs where the judge disagreed with the person. */
  disagreements: z.array(z.object({ agentRunId: z.string(), humanPassed: z.boolean(), judgePassed: z.boolean() })),
  /** Labelled runs the judge could not grade; they do not count toward agreement. */
  errors: z.array(z.object({ agentRunId: z.string(), error: z.string() })),
});

/** One check applied to one Agent Run's output. `error` means the check itself failed. */
export const EvaluatorOutcomeSchema = z.object({
  agentRunId: z.string(),
  passed: z.boolean().nullable(),
  value: z.number().min(0).max(1).nullable(),
  label: z.string().nullable(),
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
});
export const ListStepAgentRunsOutputSchema = z.object({ runs: z.array(AgentRunSchema) });

export const ListEvalCasesInputSchema = EvaluatedStepSchema.extend({
  includeArchived: QueryBooleanSchema.optional(),
});
export const ListEvalCasesOutputSchema = z.object({ cases: z.array(EvalCaseSchema) });

export const CreateEvalCaseInputSchema = EvaluatedStepSchema.extend({
  name: z.string().trim().min(1).max(200),
  input: EvalCaseInputSchema,
  workspaceSeedCommit: EvalCaseSchema.shape.workspaceSeedCommit.default(null),
  expectation: EvalCaseExpectationSchema,
  notes: z.string().trim().max(4000).nullable().default(null),
  split: EvalCaseSplitSchema.default('dev'),
  containsProductionData: z.boolean().default(false),
  origin: EvaluationOriginSchema.default('user'),
});

/**
 * "Add to eval set" from a production Agent Run: its input, the outputs before
 * it and its parent commit become the case. The expectation follows the run's
 * `human_verdict` Score — approved is positive, rejected is negative with the
 * reviewer's comment — and must be given when the run was never reviewed.
 * With `step`, the run must be a run of that step.
 */
export const CreateEvalCaseFromAgentRunInputSchema = z.object({
  agentRunId: z.string().min(1),
  step: EvaluatedStepSchema.optional(),
  name: z.string().trim().min(1).max(200).optional(),
  expectation: EvalCaseExpectationSchema.optional(),
  notes: z.string().trim().max(4000).optional(),
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
    notes: z.string().trim().min(1).max(4000),
    inputChanges: PerturbedEvalCaseSpecSchema.shape.inputChanges.unwrap().default([]),
    fileChanges: PerturbedEvalCaseSpecSchema.shape.fileChanges.unwrap().default([]),
    split: EvalCaseSplitSchema.default('dev'),
    origin: EvaluationOriginSchema.default('user'),
  })
  .refine(hasPerturbationChange, { message: 'give at least one inputChanges or fileChanges entry' });

/**
 * Seeds Eval Cases from an Evaluator's labels (EvalGen): each labelled
 * production output that is not a case yet becomes one — a pass positive, a
 * fail negative — so calibrating a check also builds the dataset.
 */
export const CreateEvalCasesFromLabelsInputSchema = z.object({
  evaluatorId: z.uuid(),
  split: EvalCaseSplitSchema.default('dev'),
});
export const CreateEvalCasesFromLabelsOutputSchema = z.object({
  cases: z.array(EvalCaseSchema),
  /** Labelled outputs that did not become a case, and why. */
  skipped: z.array(z.object({ agentRunId: z.string(), reason: z.string() })),
});

export const ArchiveEvalCaseInputSchema = z.object({
  caseId: z.uuid(),
  archived: z.boolean().default(true),
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
  /** True when the policy does not name the server and it is denied by default. */
  defaulted: z.boolean(),
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

/**
 * Prepares an Eval Run (ADR-0023 D4, D10): freezes the Dataset version (the
 * newest when none is named), the Step's live Evaluator versions and its MCP
 * eval policy, and estimates the cost. Nothing runs until `start`.
 */
export const PrepareEvalRunInputSchema = EvaluatedStepSchema.extend({
  datasetVersionId: z.uuid().optional(),
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
export const ListEvalRunsOutputSchema = z.object({ evalRuns: z.array(EvalRunSchema) });

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
export type ApproveEvaluatorSourceInput = z.infer<typeof ApproveEvaluatorSourceInputSchema>;
export type LabelEvaluatorOutputInput = z.infer<typeof LabelEvaluatorOutputInputSchema>;
export type LabelEvaluatorOutputOutput = z.infer<typeof LabelEvaluatorOutputOutputSchema>;
export type ListEvaluatorLabelsInput = z.infer<typeof ListEvaluatorLabelsInputSchema>;
export type ListEvaluatorLabelsOutput = z.infer<typeof ListEvaluatorLabelsOutputSchema>;
export type CalibrateEvaluatorInput = z.infer<typeof CalibrateEvaluatorInputSchema>;
export type CalibrateEvaluatorOutput = z.infer<typeof CalibrateEvaluatorOutputSchema>;
export type EvaluatorOutcome = z.infer<typeof EvaluatorOutcomeSchema>;
export type PreviewEvaluatorInput = z.input<typeof PreviewEvaluatorInputSchema>;
export type PreviewEvaluatorOutput = z.infer<typeof PreviewEvaluatorOutputSchema>;
export type ListStepAgentRunsInput = z.input<typeof ListStepAgentRunsInputSchema>;
export type ListStepAgentRunsOutput = z.infer<typeof ListStepAgentRunsOutputSchema>;
export type ListEvalCasesInput = z.input<typeof ListEvalCasesInputSchema>;
export type ListEvalCasesOutput = z.infer<typeof ListEvalCasesOutputSchema>;
export type CreateEvalCaseInput = z.input<typeof CreateEvalCaseInputSchema>;
export type CreateEvalCaseFromAgentRunInput = z.input<typeof CreateEvalCaseFromAgentRunInputSchema>;
export type EvalCaseOutput = z.infer<typeof EvalCaseOutputSchema>;
export type CreatePerturbedEvalCaseInput = z.input<typeof CreatePerturbedEvalCaseInputSchema>;
export type CreateEvalCasesFromLabelsInput = z.input<typeof CreateEvalCasesFromLabelsInputSchema>;
export type CreateEvalCasesFromLabelsOutput = z.infer<typeof CreateEvalCasesFromLabelsOutputSchema>;
export type ArchiveEvalCaseInput = z.input<typeof ArchiveEvalCaseInputSchema>;
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
