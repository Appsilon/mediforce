import { z } from 'zod';
import { AgentOutputSchemaSchema } from './workflow-definition';
import { CommitShaSchema } from './process-definition';
import { StepMcpRestrictionSchema } from './agent-mcp-binding';

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
  /**
   * Cohen's κ — agreement beyond what the label mix gives by chance. Null when
   * it is undefined (every label and verdict the same); absent on calibrations
   * recorded before it was.
   */
  kappa: z.number().min(-1).max(1).nullable().optional(),
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
/** `synthesized`: a production run's input with a deliberate change — see `perturbation`. */
export const EvalCaseSourceSchema = z.enum(['production', 'manual', 'synthesized']);

/** The kinds of change a synthesized case makes to a real production input. */
export const EvalCasePerturbationKindSchema = z.enum([
  'missing_file',
  'extra_file',
  'renamed_columns',
  'edge_values',
  'injected_instruction',
  'other',
]);

/** What a synthesized case changed, in words; the change itself is in its input and seed commit. */
export const EvalCasePerturbationSchema = z.object({
  kind: EvalCasePerturbationKindSchema,
  description: z.string().min(1).max(1000),
});

/** Which part of an Eval Case input a change addresses. */
export const EvalCaseInputPartSchema = z.enum(['triggerPayload', 'previousStepOutputs', 'previousRun']);

/**
 * One change to a case input. `path` walks keys (and array indexes, as
 * digits) below `part`; `set` may add the last key, `remove` needs it to exist.
 */
export const EvalCaseInputChangeSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), part: EvalCaseInputPartSchema, path: z.array(z.string().min(1)).min(1), value: z.unknown() }),
  z.object({ op: z.literal('remove'), part: EvalCaseInputPartSchema, path: z.array(z.string().min(1)).min(1) }),
]);

/** A workspace-relative file path: no leading slash, no `.` or `..` segments, nothing under `.git`. */
export const WorkspaceFilePathSchema = z.string().min(1).max(500).refine(
  (path) => path.startsWith('/') === false
    && path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
    && path.split('/')[0] !== '.git',
  { message: 'a relative path inside the workspace, without . or .. segments, not under .git' },
);

/**
 * One change to the workspace a case starts from. `replace` swaps the first
 * occurrence of `search` in a text file and fails when there is none.
 */
export const WorkspaceFileChangeSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('write'), path: WorkspaceFilePathSchema, content: z.string().max(200_000) }),
  z.object({ op: z.literal('delete'), path: WorkspaceFilePathSchema }),
  z.object({ op: z.literal('replace'), path: WorkspaceFilePathSchema, search: z.string().min(1).max(10_000), replace: z.string().max(10_000) }),
]);
export const EvalCaseSplitSchema = z.enum(['dev', 'holdout']);

/**
 * A case synthesized from a production Agent Run: its input and the workspace
 * it started from, with deliberate changes — a missing or extra file, renamed
 * columns, edge values, an instruction injected into the data.
 */
export const PerturbedEvalCaseSpecSchema = z.object({
  name: z.string().min(1).max(200),
  baseAgentRunId: z.string().min(1),
  perturbation: EvalCasePerturbationSchema,
  inputChanges: z.array(EvalCaseInputChangeSchema).max(20).optional(),
  fileChanges: z.array(WorkspaceFileChangeSchema).max(20).optional(),
  expectation: EvalCaseExpectationSchema,
  /** What the output must — or must not — do with the changed input. */
  notes: z.string().min(1).max(4000),
  split: EvalCaseSplitSchema.optional(),
});

export function hasPerturbationChange(spec: { inputChanges?: readonly unknown[]; fileChanges?: readonly unknown[] }): boolean {
  return (spec.inputChanges?.length ?? 0) + (spec.fileChanges?.length ?? 0) > 0;
}

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
  /** Set on a `synthesized` case: what it changed about its source run's input. */
  perturbation: EvalCasePerturbationSchema.nullable(),
  origin: EvaluationOriginSchema,
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

/**
 * One Acceptance Criterion (D10): what every counted Evaluator of a severity
 * must reach — its pass rate's Wilson 95% lower bound, and optionally pass^k,
 * the share of cases where every trial passed.
 */
export const AcceptanceCriterionSchema = z.object({
  minPassRate: z.number().min(0).max(1),
  minPassHatK: z.number().min(0).max(1).optional(),
});

/** Acceptance Criteria per severity; a severity without one is not judged. */
export const AcceptanceCriteriaSchema = z.object({
  critical: AcceptanceCriterionSchema.optional(),
  major: AcceptanceCriterionSchema.optional(),
  minor: AcceptanceCriterionSchema.optional(),
}).refine((criteria) => criteria.critical !== undefined || criteria.major !== undefined || criteria.minor !== undefined, {
  message: 'set a criterion for at least one severity',
});

/** A Step's Acceptance Criteria, set before an Eval Run and frozen into it. Every write is a new version. */
export const AcceptanceCriteriaVersionSchema = EvaluatedStepSchema.extend({
  version: z.number().int().positive(),
  criteria: AcceptanceCriteriaSchema,
  origin: EvaluationOriginSchema,
  createdBy: z.string().min(1),
  createdAt: z.iso.datetime(),
});

/**
 * A variant of the Step (D5): an override patch applied at trial time over
 * the pinned Definition version. `prompt` and `allowedTools` replace the
 * step's own; `mcpRestrictions` narrow it further, never widen it;
 * `skillCommit` moves the workflow's external skills repository.
 */
export const StepVariantPatchSchema = z.object({
  model: z.string().min(1).optional(),
  prompt: z.string().min(1).max(64_000).optional(),
  skillCommit: CommitShaSchema.optional(),
  allowedTools: z.array(z.string().min(1)).max(50).optional(),
  mcpRestrictions: StepMcpRestrictionSchema.optional(),
}).strict();

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
export type EvalCasePerturbation = z.infer<typeof EvalCasePerturbationSchema>;
export type EvalCaseInputChange = z.infer<typeof EvalCaseInputChangeSchema>;
export type WorkspaceFileChange = z.infer<typeof WorkspaceFileChangeSchema>;
export type EvalCase = z.infer<typeof EvalCaseSchema>;
export type EvalDatasetVersion = z.infer<typeof EvalDatasetVersionSchema>;
export type McpEvalServerPolicy = z.infer<typeof McpEvalServerPolicySchema>;
export type McpEvalPolicy = z.infer<typeof McpEvalPolicySchema>;
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;
export type AcceptanceCriteria = z.infer<typeof AcceptanceCriteriaSchema>;
export type AcceptanceCriteriaVersion = z.infer<typeof AcceptanceCriteriaVersionSchema>;
export type StepVariantPatch = z.infer<typeof StepVariantPatchSchema>;
