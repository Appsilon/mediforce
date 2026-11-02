import { z } from 'zod';
import {
  AcceptanceCriteriaSchema,
  CodeCheckSchema,
  EvalCaseComparisonSchema,
  EvalCaseExpectationSchema,
  EvalCaseInputSchema,
  EvalCaseLabelSchema,
  EvalCaseSplitSchema,
  EvaluatorCheckSchema,
  EvaluatorKindSchema,
  EvaluatorSchema,
  ExpectedOutputCheckSchema,
  LlmJudgeCheckSchema,
  PerturbedEvalCaseSpecSchema,
  SchemaCheckSchema,
  WorkspaceFilePathSchema,
  hasPerturbationChange,
  type EvaluationSubject,
} from './evaluation';

/**
 * The Evaluation Assistant's tools (ADR-0023 D14, D15), by what the assistant
 * may do with them.
 *
 * *Proposals* never run: the call comes back to the person as a card to
 * accept or reject, and accepting goes through the same handler a
 * person's own form uses. *Platform* tools run as the person asking — reads,
 * a draft check against real outputs, preparing an Eval Run, and starting one
 * only under an unattended budget the person granted for the request. Nothing here
 * signs a Step Qualification, approves a check's source or reviews a judge's
 * verdict: D15 keeps those human, so there is no tool to call.
 */

const SCRIPTED_CHECK_EXAMPLES = [
  { kind: 'schema', schema: { required: ['findings'] } },
  {
    kind: 'code', runtime: 'python',
    source: 'import json\nwith open("/output/input.json") as handle:\n    data = json.load(handle)\nwith open("/output/result.json", "w") as handle:\n    json.dump({"passed": "findings" in data["result"]}, handle)',
  },
];

/** A judge's model is the platform's pinned default unless the person asked for one. */
const AssistantJudgeModelSchema = z.string().min(1).optional()
  .describe('Leave out: the platform sets the pinned default model. Set it only to the model the person asked for.');

const AssistantCheckSchema = z.discriminatedUnion('kind', [
  SchemaCheckSchema,
  CodeCheckSchema,
  LlmJudgeCheckSchema.extend({ model: AssistantJudgeModelSchema }),
  ExpectedOutputCheckSchema.extend({ model: AssistantJudgeModelSchema }),
]).describe(
  'A JSON object, not a string or JSON-encoded string. For code use {"kind":"code","runtime":"python","source":"...script..."}; only source is a string. Choose schema, code or llm_judge and include that kind\'s required fields.',
).meta({ examples: [
  ...SCRIPTED_CHECK_EXAMPLES,
  { kind: 'llm_judge', rubric: 'Does the result explain its findings?', minConfidence: 0.8 },
  { kind: 'expected_output', instructions: 'Wording of free text is trivial; a changed grade or term is not.', minAgreement: 0.9, maxAgreement: 0.1 },
] });

/** A check the assistant may preview: a judge or an expected-output check is never previewed by it. */
const PreviewableCheckSchema = z.discriminatedUnion('kind', [SchemaCheckSchema, CodeCheckSchema]).describe(
  'A JSON object, not a string or JSON-encoded string: schema or code only — a judge is proposed untried. For code use {"kind":"code","runtime":"python","source":"...script..."}; only source is a string.',
).meta({ examples: SCRIPTED_CHECK_EXAMPLES });

/** A check as the assistant proposes it: a judge may leave its model to the platform. */
export type AssistantCheck = z.infer<typeof AssistantCheckSchema>;

/** Models name rules in prose or snake_case; an Evaluator's name is kebab-case. */
const AssistantEvaluatorNameSchema = z.string()
  .describe('kebab-case: lowercase letters, digits and dashes, at most 63 characters')
  .transform((name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 63).replace(/-+$/, ''))
  .pipe(EvaluatorSchema.shape.name);

/** Propose an Evaluator for the step — as its card holds it, with the check that will be saved. */
export const ProposeEvaluatorToolSchema = z.object({
  name: AssistantEvaluatorNameSchema,
  rule: z.string().min(1).max(2000),
  check: EvaluatorCheckSchema,
  /** Why this check, and what its preview showed. */
  rationale: z.string().max(1000).optional(),
  runInProduction: z.boolean().optional()
    .describe('Also score live production runs of the step (a guardrail). A failing schema or code check escalates the run to a person; an llm_judge only writes Scores. A code check counts only once a person approves its source.'),
});

/** Propose an Eval Case: from a production Agent Run, or written out. */
export const ProposeEvalCaseToolSchema = z.object({
  name: z.string().min(1).max(200),
  agentRunId: z.string().min(1)
    .describe('Harvest this production run: the case takes the run\'s own input — do not also send input. Override its expected output with expectedOutput.')
    .optional(),
  input: EvalCaseInputSchema
    .describe('A written input, instead of agentRunId.')
    .optional(),
  /** The output the step should return — or, for a negative case, must not return. */
  expectedOutput: EvalCaseLabelSchema.shape.expectedOutput.optional(),
  expectation: EvalCaseExpectationSchema.optional(),
  comparison: EvalCaseComparisonSchema.optional(),
  agreementInstructions: z.string().max(4000).optional(),
  split: EvalCaseSplitSchema.optional(),
  /** A written input copied from a production run carries its data. */
  containsProductionData: z.boolean().optional()
    .describe('true when the written input is copied from, or built on, a production run\'s data'),
  rationale: z.string().max(1000).optional(),
}).refine((value) => (value.agentRunId === undefined) !== (value.input === undefined), {
  message: 'give exactly one of agentRunId (harvest a production run) or input (a written case) — to keep a run\'s own input, send its agentRunId and drop input',
});

/** Propose a new version of the step's Evaluation Brief. */
export const ProposeBriefToolSchema = z.object({
  text: z.string().min(1).max(4000),
});

/**
 * An evaluation plan for the step: what could go wrong, the cheapest check
 * that would catch it, and the cases to try it on — plus the Acceptance
 * Criteria it suggests. `risks` is ranked by its order, highest risk first.
 * Nothing is created from a plan: each
 * check is drafted, previewed and proposed on its own.
 */
export const ProposeEvaluationPlanToolSchema = z.object({
  summary: z.string().min(1).max(2000),
  risks: z.array(z.object({
    /** What could go wrong, in the step's own terms. */
    failure: z.string().min(1).max(500),
    /** Why it matters — the Brief, the step's config, what its runs show. */
    why: z.string().min(1).max(1000),
    check: z.object({ kind: EvaluatorKindSchema, rule: z.string().min(1).max(2000) }),
    /** Inputs worth running it on, in words. */
    cases: z.array(z.string().min(1).max(500)).max(5).optional(),
  })).min(1).max(12),
  /** The minimum pass rate every counted Evaluator must reach, judged on the pass rate itself (D10). */
  minPassRate: z.number().min(0).max(1),
});

/** Propose a new version of an existing Evaluator — a refined rule or rubric. */
const EvaluatorVersionProposalSchema = z.object({
  evaluatorId: z.uuid(),
  rule: z.string().min(1).max(2000).optional(),
  check: EvaluatorCheckSchema.optional(),
  /** What changed and why — a judge rationale a person denied, a preview. */
  rationale: z.string().max(1000).optional(),
});

const changesRuleOrCheck = (value: { rule?: string; check?: unknown }) => value.rule !== undefined || value.check !== undefined;
const CHANGE_RULE_OR_CHECK = { message: 'change at least one of rule or check' };

/** As its card holds it, with the check that will be saved. */
export const ProposeEvaluatorVersionToolSchema = EvaluatorVersionProposalSchema
  .refine(changesRuleOrCheck, CHANGE_RULE_OR_CHECK);

/** The Evaluator proposals as the assistant sends them: a judge may leave its model to the platform, which completes the card. */
const AssistantProposeEvaluatorSchema = ProposeEvaluatorToolSchema.extend({ check: AssistantCheckSchema });
const AssistantProposeEvaluatorVersionSchema = EvaluatorVersionProposalSchema
  .extend({ check: AssistantCheckSchema.optional() })
  .refine(changesRuleOrCheck, CHANGE_RULE_OR_CHECK);

/** Propose a case synthesized from a production run by changing its input or workspace. */
export const ProposePerturbedCaseToolSchema = PerturbedEvalCaseSpecSchema.extend({
  rationale: z.string().max(1000).optional(),
}).refine(hasPerturbationChange, {
  message: 'give at least one inputChanges or fileChanges entry — to change only the expected output (an error planted in a run\'s output), use propose_eval_case with agentRunId and expectedOutput',
});

/**
 * Propose the step's Acceptance Criteria (D10): the minimum pass rate every
 * counted Evaluator must reach, and optionally a minimum pass^k. Set
 * before the Eval Runs judged against them; accepting writes a new version.
 */
export const ProposeAcceptanceCriteriaToolSchema = z.object({
  criteria: AcceptanceCriteriaSchema,
  /** Why these floors: the risks, the Brief, what a miss costs. */
  rationale: z.string().min(1).max(2000),
});

/**
 * Recommend how the step's outputs are routed after an Eval Run: `L4`
 * (Control Mode 4), the agent applying its output, or `L3` (Control Mode 3),
 * a person reviewing every output. A recommendation card — the person
 * changes the step in the workflow editor.
 */
export const ProposeControlSettingsToolSchema = z.object({
  evalRunId: z.uuid(),
  autonomyLevel: z.enum(['L3', 'L4']),
  /** What in the report supports it: criteria, pass rates. */
  rationale: z.string().min(1).max(2000),
});

/** Why a group of an Eval Run's failing trials failed. */
export const FailureRootCauseSchema = z.enum([
  'ambiguous_instruction',
  'missing_context',
  'tool_problem',
  'model_capability',
  'evaluator_wrong',
]);

/**
 * What would fix a root cause. `instruction`, `examples`, `model` and `tools`
 * are changes to the step the person makes; a `guardrail` is a production
 * Evaluator (`propose_evaluator` with `runInProduction`), `control_mode` a
 * routing change (`propose_control_settings`), `evaluator` a new version of a
 * wrong Evaluator (`propose_evaluator_version`), and a `preprocessing_step` a
 * change to the workflow made in the workflow editor.
 */
export const FixKindSchema = z.enum([
  'instruction',
  'examples',
  'guardrail',
  'model',
  'tools',
  'preprocessing_step',
  'control_mode',
  'evaluator',
]);

/**
 * A diagnosis of an Eval Run's failures: its failing trials
 * grouped by root cause, each group with its evidence and the kind of fix it
 * points to. A card only — nothing is created.
 */
export const ProposeDiagnosisToolSchema = z.object({
  evalRunId: z.uuid(),
  clusters: z.array(z.object({
    rootCause: FailureRootCauseSchema,
    summary: z.string().min(1).max(1000),
    trialIds: z.array(z.uuid()).min(1).max(50),
    /** What in the trajectories, outputs and cases shows it. */
    evidence: z.string().min(1).max(2000),
    fix: z.object({ kind: FixKindSchema, description: z.string().min(1).max(2000) }),
  })).min(1).max(8),
});

export const EVALUATION_ASSISTANT_PROPOSAL_TOOLS = {
  propose_evaluation_plan: ProposeEvaluationPlanToolSchema,
  propose_evaluator: AssistantProposeEvaluatorSchema,
  propose_evaluator_version: AssistantProposeEvaluatorVersionSchema,
  propose_eval_case: ProposeEvalCaseToolSchema,
  propose_perturbed_case: ProposePerturbedCaseToolSchema,
  propose_brief: ProposeBriefToolSchema,
  propose_acceptance_criteria: ProposeAcceptanceCriteriaToolSchema,
  propose_control_settings: ProposeControlSettingsToolSchema,
  propose_diagnosis: ProposeDiagnosisToolSchema,
} as const;

const NoArguments = z.object({});
const WorkspaceMomentSchema = z.enum(['start', 'end']).default('start')
  .describe('"start": the workspace the run started from. "end": the workspace the run left, with the files it wrote.');

export const EVALUATION_ASSISTANT_PLATFORM_TOOLS = {
  /**
   * The step as it runs: config, agent prompt, input/output descriptions,
   * allowed tools, effective MCP servers with their eval policy, the catalog
   * Skills it is offered with their SKILL.md, and the steps upstream of it.
   */
  get_step: NoArguments,
  /**
   * The Agent as it runs on its own (ADR-0029): system prompt, model, runtime,
   * input/output descriptions, effective MCP servers with their eval policy and
   * the catalog Skills it is offered with their SKILL.md.
   */
  get_agent: NoArguments,
  /**
   * The Steps that use the Agent, with what each adds to it, and their recent
   * finished production Agent Runs — the input each was given, what its Step
   * changes about the Agent and the reviewer's verdict — to take the Agent's
   * cases from.
   */
  list_agent_production_runs: z.object({ limit: z.number().int().min(1).max(50).optional() }),
  /** Recent Workflow Runs of the step, each with the step's finished Agent Runs oldest first — one per review round — and the reviewer's verdict on each. */
  list_step_runs: z.object({
    limit: z.number().int().min(1).max(50).optional()
      .describe('How many of the step\'s recent Agent Runs to sample (default 10); each brings every review round of its Workflow Run, so fewer Workflow Runs may come back.'),
  }),
  /** One Agent Run: status, fallback, input it was given and the result it produced. */
  get_agent_run: z.object({ agentRunId: z.string().min(1) }),
  /** The tool calls and results of one Agent Run. */
  get_trajectory: z.object({
    agentRunId: z.string().min(1),
    offset: z.number().int().nonnegative().default(0)
      .describe('The zero-based entry offset, not a seq value. Start at 0; use nextOffset from the previous response to continue.'),
    limit: z.number().int().min(1).max(150).default(50)
      .describe('Maximum number of complete entries per page (1–150; default 50). Use a smaller limit for large tool payloads.'),
  }).describe('Read an Agent Run trajectory in stored order, including system and thinking entries, without truncating entry content. Returns { entries, total, nextOffset }; total is the full entry count. Request subsequent pages using nextOffset as offset until nextOffset is null. An offset at or beyond total returns an empty page with nextOffset null.'),
  list_workspace_files: z.object({ agentRunId: z.string().min(1), at: WorkspaceMomentSchema })
    .describe('List the files of an Agent Run\'s workspace. at "start" (default) is the workspace the run started from — what a case from it starts from; at "end" it also holds the files the run wrote (its changedFiles). Refuses a run that gave no result.'),
  read_workspace_file: z.object({ agentRunId: z.string().min(1), path: WorkspaceFilePathSchema, at: WorkspaceMomentSchema })
    .describe('Read one text file of an Agent Run\'s workspace. A file the run wrote (its changedFiles) is there only at "end"; at "start" (default) is the workspace the run started from. Refuses a run that gave no result.'),
  list_evaluators: NoArguments,
  list_eval_cases: NoArguments,
  list_eval_runs: NoArguments,
  /** One Eval Run's report, to explain it. */
  get_eval_run_report: z.object({ evalRunId: z.string().min(1) }),
  /**
   * An Eval Run's failing trials — a counted Evaluator failed,
   * a check errored, or the trial produced no Agent Run — with each trial's
   * case and the Evaluators that failed or errored on it.
   */
  get_failures: z.object({ evalRunId: z.uuid() }),
  /** Run a draft check against the step's Eval Cases, then its recent outputs; writes nothing. */
  preview_evaluator: z.object({
    check: PreviewableCheckSchema,
    agentRunIds: z.array(z.string().min(1)).min(1).max(10).optional()
      .describe('Only these production runs, and no Eval Case'),
  }),
  /**
   * Prepare an Eval Run of the step as it is over the newest Dataset version,
   * which the person confirms the cost of to start it.
   */
  prepare_eval_run: z.object({
    trialsPerCase: z.number().int().min(1).max(10).optional(),
    budgetUsd: z.number().positive().max(10_000).optional(),
  }),
  /**
   * The step's qualification: Qualified, Stale (and what changed) or Not
   * qualified, the qualification's criteria and deviations, Evaluators changed
   * since, and the Acceptance Criteria set now.
   */
  get_qualification: NoArguments,
  /**
   * Start a prepared Eval Run. Refused unless the person granted an unattended
   * budget for this request and the run's budget fits what is left of it.
   */
  start_eval_run: z.object({ evalRunId: z.string().min(1) }),
} as const;

export type EvaluationAssistantProposalToolName = keyof typeof EVALUATION_ASSISTANT_PROPOSAL_TOOLS;
export type EvaluationAssistantPlatformToolName = keyof typeof EVALUATION_ASSISTANT_PLATFORM_TOOLS;

/** The tools of one Evaluation Assistant: a selection from the shared catalogs. */
interface EvaluationAssistantToolset {
  readonly platform: readonly EvaluationAssistantPlatformToolName[];
  readonly proposals: readonly EvaluationAssistantProposalToolName[];
}

const READ_EVALUATION = ['list_evaluators', 'list_eval_cases', 'list_eval_runs', 'get_eval_run_report', 'get_failures', 'get_qualification'] as const;
const RUN_EVALUATION = ['prepare_eval_run', 'start_eval_run'] as const;
const READ_RUNS = ['get_agent_run', 'get_trajectory'] as const;
const SHARED_PROPOSALS = [
  'propose_evaluation_plan', 'propose_evaluator', 'propose_evaluator_version', 'propose_eval_case',
  'propose_brief', 'propose_acceptance_criteria', 'propose_diagnosis',
] as const;

/**
 * Which tools the assistant has, by what it evaluates. One catalog and one
 * executor serve both: a Step reads its own production runs and workspaces,
 * previews checks on them, synthesizes cases from them and recommends a
 * Control Mode; an Agent (ADR-0029) reads itself and the production runs of
 * the Steps that use it, to write its cases from.
 */
export const EVALUATION_ASSISTANT_TOOLSETS = {
  step: {
    platform: ['get_step', 'list_step_runs', ...READ_RUNS, 'list_workspace_files', 'read_workspace_file', ...READ_EVALUATION, 'preview_evaluator', ...RUN_EVALUATION],
    proposals: [...SHARED_PROPOSALS, 'propose_perturbed_case', 'propose_control_settings'],
  },
  agent: {
    platform: ['get_agent', 'list_agent_production_runs', ...READ_RUNS, ...READ_EVALUATION, ...RUN_EVALUATION],
    proposals: SHARED_PROPOSALS,
  },
} as const satisfies Record<EvaluationSubject['kind'], EvaluationAssistantToolset>;

/** The catalog entries `names` select. */
export function pickTools<Name extends string, Selected extends Name, Schema extends z.ZodType>(
  catalog: Readonly<Record<Name, Schema>>,
  names: readonly Selected[],
): Record<Selected, Schema> {
  return Object.fromEntries(names.map((name) => [name, catalog[name]])) as Record<Selected, Schema>;
}

/** What the assistant proposed this turn, for the person to accept or reject. */
export const EvaluationAssistantProposalSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('propose_evaluation_plan'), arguments: ProposeEvaluationPlanToolSchema }),
  z.object({ tool: z.literal('propose_evaluator'), arguments: ProposeEvaluatorToolSchema }),
  z.object({ tool: z.literal('propose_evaluator_version'), arguments: ProposeEvaluatorVersionToolSchema }),
  z.object({ tool: z.literal('propose_eval_case'), arguments: ProposeEvalCaseToolSchema }),
  z.object({ tool: z.literal('propose_perturbed_case'), arguments: ProposePerturbedCaseToolSchema }),
  z.object({ tool: z.literal('propose_brief'), arguments: ProposeBriefToolSchema }),
  z.object({ tool: z.literal('propose_acceptance_criteria'), arguments: ProposeAcceptanceCriteriaToolSchema }),
  z.object({ tool: z.literal('propose_control_settings'), arguments: ProposeControlSettingsToolSchema }),
  z.object({ tool: z.literal('propose_diagnosis'), arguments: ProposeDiagnosisToolSchema }),
]);

export type EvaluationAssistantProposal = z.infer<typeof EvaluationAssistantProposalSchema>;
export type FailureRootCause = z.infer<typeof FailureRootCauseSchema>;
export type FixKind = z.infer<typeof FixKindSchema>;
