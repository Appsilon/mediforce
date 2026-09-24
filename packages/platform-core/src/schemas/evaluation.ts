import { z } from 'zod';
import { AgentOutputSchemaSchema } from './workflow-definition';

/**
 * The Evaluation domain of ADR-0023: everything is owned by one agent Workflow
 * Step, keyed by `(namespace, workflowName, stepId)` and kept outside the
 * immutable Workflow Definition, so adding a check never mints a Definition
 * version (D2).
 */
export const EvaluatedStepSchema = z.object({
  namespace: z.string().min(1),
  workflowName: z.string().min(1),
  stepId: z.string().min(1),
});

/** Who put a thing there: a person, or the Evaluation Assistant's proposal a person accepted. */
export const EvaluationOriginSchema = z.enum(['user', 'assistant']);

/** A Step's context of use (D16). Every write is a new version. */
export const EvaluationBriefSchema = EvaluatedStepSchema.extend({
  version: z.number().int().positive(),
  text: z.string().min(1).max(4000),
  origin: EvaluationOriginSchema,
  createdBy: z.string().min(1),
  createdAt: z.iso.datetime(),
});

export const EvaluatorKindSchema = z.enum(['schema', 'code', 'llm_judge']);
export const EvaluatorSeveritySchema = z.enum(['critical', 'major', 'minor']);

/** Checks the step's `result` against the structural JSON Schema subset `agent.outputSchema` uses. */
export const SchemaCheckSchema = z.object({
  kind: z.literal('schema'),
  schema: AgentOutputSchemaSchema,
});

/**
 * A script run in the `script-container` sandbox with the step's workspace
 * commit read-only at `/workspace` and `/output/input.json` holding `result`,
 * `stepInput`, `trajectory` and the Eval Case. It writes `/output/result.json` as
 * `{ "passed": boolean, "comment"?: string }`.
 */
export const CodeCheckSchema = z.object({
  kind: z.literal('code'),
  runtime: z.enum(['python', 'javascript']),
  source: z.string().min(1).max(64_000),
});

/** One answer a judge may give. A choice passes when its `value` is at least 0.5. */
export const JudgeChoiceSchema = z.object({
  label: z.string().min(1).max(40),
  value: z.number().min(0).max(1),
});

/** An LLM judge: reasoning first, then one of a few discrete choices (layer-2 research § 3). */
export const LlmJudgeCheckSchema = z.object({
  kind: z.literal('llm_judge'),
  model: z.string().min(1),
  rubric: z.string().min(1).max(8000),
  choices: z.array(JudgeChoiceSchema).min(2).max(6)
    .refine((choices) => new Set(choices.map((choice) => choice.label)).size === choices.length, {
      message: 'choice labels must be unique',
    }),
});

export const EvaluatorCheckSchema = z.discriminatedUnion('kind', [
  SchemaCheckSchema,
  CodeCheckSchema,
  LlmJudgeCheckSchema,
]);

export const JUDGE_PASS_VALUE = 0.5;

/** A `code` check counts only after a person has approved its source (D9). */
export const SourceApprovalSchema = z.object({
  approvedBy: z.string().min(1),
  approvedAt: z.iso.datetime(),
});

/** How often a judge version agreed with human labels on the same Agent Runs (D9). */
export const JudgeCalibrationSchema = z.object({
  agreement: z.number().min(0).max(1),
  labelCount: z.number().int().nonnegative(),
  failureLabelCount: z.number().int().nonnegative(),
  calibratedAt: z.iso.datetime(),
});

/** Evaluator identity. What it checks lives on its versions. */
export const EvaluatorSchema = EvaluatedStepSchema.extend({
  id: z.uuid(),
  /** Stable handle, also the name of the Scores it writes. */
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'lowercase letters, digits and dashes'),
  archived: z.boolean(),
  createdBy: z.string().min(1),
  createdAt: z.iso.datetime(),
});

/**
 * One immutable version of an Evaluator (D7). A change is a new version, so a
 * version that produced a Score never changes under the Scores it produced.
 * Approval and calibration attach to a version; they are not part of what it checks.
 */
export const EvaluatorVersionSchema = z.object({
  evaluatorId: z.uuid(),
  version: z.number().int().positive(),
  /** The plain-language rule the check stands for. */
  rule: z.string().min(1).max(2000),
  severity: EvaluatorSeveritySchema,
  check: EvaluatorCheckSchema,
  origin: EvaluationOriginSchema,
  sourceApproval: SourceApprovalSchema.nullable(),
  calibration: JudgeCalibrationSchema.nullable(),
  createdBy: z.string().min(1),
  createdAt: z.iso.datetime(),
});

/**
 * What a trial seeds the step with: the trigger payload and the outputs of the
 * steps before it (`instance.variables`), plus the run's carry-over when the
 * workflow declares one. Together they rebuild the step's input exactly.
 */
export const EvalCaseInputSchema = z.object({
  triggerPayload: z.record(z.string(), z.unknown()),
  previousStepOutputs: z.record(z.string(), z.unknown()),
  previousRun: z.record(z.string(), z.unknown()).optional(),
});

/** An approved production output is a positive case; a rejected one is negative. */
export const EvalCaseExpectationSchema = z.enum(['positive', 'negative']);
export const EvalCaseSourceSchema = z.enum(['production', 'manual']);
export const EvalCaseSplitSchema = z.enum(['dev', 'holdout']);

export const EvalCaseSchema = EvaluatedStepSchema.extend({
  id: z.uuid(),
  name: z.string().min(1).max(200),
  input: EvalCaseInputSchema,
  /** Commit on the workflow's bare repo a trial's run branch starts from; null for an empty workspace. */
  workspaceSeedCommit: z.string().regex(/^[0-9a-f]{7,64}$/).nullable(),
  expectation: EvalCaseExpectationSchema,
  /** What the output must — or must not — contain; a rejecting reviewer's comment for a negative case. */
  notes: z.string().max(4000).nullable(),
  source: EvalCaseSourceSchema,
  sourceAgentRunId: z.string().nullable(),
  split: EvalCaseSplitSchema,
  containsProductionData: z.boolean(),
  archived: z.boolean(),
  createdBy: z.string().min(1),
  createdAt: z.iso.datetime(),
});

/** A frozen set of a Step's Eval Cases; an Eval Run runs one of these. */
export const EvalDatasetVersionSchema = EvaluatedStepSchema.extend({
  id: z.uuid(),
  version: z.number().int().positive(),
  caseIds: z.array(z.uuid()).min(1),
  containsProductionData: z.boolean(),
  createdBy: z.string().min(1),
  createdAt: z.iso.datetime(),
});

/**
 * What an eval trial may do with one MCP server (D6): `live`, optionally with
 * named tools denied, or `deny`. A server the policy does not name is denied.
 */
export const McpEvalServerPolicySchema = z.object({
  mode: z.enum(['live', 'deny']),
  denyTools: z.array(z.string().min(1)).optional(),
});

export const McpEvalPolicySchema = EvaluatedStepSchema.extend({
  servers: z.record(z.string().min(1), McpEvalServerPolicySchema),
  updatedBy: z.string().min(1),
  updatedAt: z.iso.datetime(),
});

export type EvaluatedStep = z.infer<typeof EvaluatedStepSchema>;
export type EvaluationOrigin = z.infer<typeof EvaluationOriginSchema>;
export type EvaluationBrief = z.infer<typeof EvaluationBriefSchema>;
export type EvaluatorKind = z.infer<typeof EvaluatorKindSchema>;
export type EvaluatorSeverity = z.infer<typeof EvaluatorSeveritySchema>;
export type EvaluatorCheck = z.infer<typeof EvaluatorCheckSchema>;
export type JudgeChoice = z.infer<typeof JudgeChoiceSchema>;
export type SourceApproval = z.infer<typeof SourceApprovalSchema>;
export type JudgeCalibration = z.infer<typeof JudgeCalibrationSchema>;
export type Evaluator = z.infer<typeof EvaluatorSchema>;
export type EvaluatorVersion = z.infer<typeof EvaluatorVersionSchema>;
export type EvalCaseInput = z.infer<typeof EvalCaseInputSchema>;
export type EvalCaseExpectation = z.infer<typeof EvalCaseExpectationSchema>;
export type EvalCase = z.infer<typeof EvalCaseSchema>;
export type EvalDatasetVersion = z.infer<typeof EvalDatasetVersionSchema>;
export type McpEvalServerPolicy = z.infer<typeof McpEvalServerPolicySchema>;
export type McpEvalPolicy = z.infer<typeof McpEvalPolicySchema>;
