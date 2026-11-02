import { z } from 'zod';
import {
  AcceptanceCriteriaSchema,
  EvalCaseComparisonSchema,
  EvalCaseExpectationSchema,
  EvalCaseInputSchema,
  EvalCaseLabelSchema,
  EvalCaseSplitSchema,
  CodeCheckSchema,
  EvaluatorCheckSchema,
  EvaluatorKindSchema,
  EvaluatorSchema,
  PerturbedEvalCaseSpecSchema,
  SchemaCheckSchema,
  WorkspaceFilePathSchema,
  hasPerturbationChange,
  type EvaluationSubject,
} from './evaluation';
import { FALLBACK_PINNED_MODEL } from './model-registry';

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

const AssistantCheckSchema = EvaluatorCheckSchema.describe(
  'A JSON object, not a string or JSON-encoded string. For code use {"kind":"code","runtime":"python","source":"...script..."}; only source is a string. Choose schema, code or llm_judge and include that kind\'s required fields.',
).meta({ examples: [
  { kind: 'schema', schema: { required: ['findings'] } },
  {
    kind: 'code', runtime: 'python',
    source: 'import json\nwith open("/output/input.json") as handle:\n    data = json.load(handle)\nwith open("/output/result.json", "w") as handle:\n    json.dump({"passed": "findings" in data["result"]}, handle)',
  },
  { kind: 'llm_judge', model: FALLBACK_PINNED_MODEL, rubric: 'Does the result explain its findings?', minConfidence: 0.8 },
  { kind: 'expected_output', model: FALLBACK_PINNED_MODEL, instructions: 'Wording of free text is trivial; a changed grade or term is not.', minAgreement: 0.9, maxAgreement: 0.1 },
] });

/** Models name rules in prose or snake_case; an Evaluator's name is kebab-case. */
const AssistantEvaluatorNameSchema = z.string()
  .describe('kebab-case: lowercase letters, digits and dashes, at most 63 characters')
  .transform((name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 63).replace(/-+$/, ''))
  .pipe(EvaluatorSchema.shape.name);

/** Propose an Evaluator for the step. */
export const ProposeEvaluatorToolSchema = z.object({
  name: AssistantEvaluatorNameSchema,
  rule: z.string().min(1).max(2000),
  check: AssistantCheckSchema,
  /** Why this check, and what its preview showed. */
  rationale: z.string().max(1000).optional(),
  runInProduction: z.boolean().optional()
    .describe('Also score live production runs of the step (a guardrail). A failing schema or code check escalates the run to a person; an llm_judge only writes Scores. A code check counts only once a person approves its source.'),
});

/** Propose an Eval Case: from a production Agent Run, or written out. */
export const ProposeEvalCaseToolSchema = z.object({
  name: z.string().min(1).max(200),
  agentRunId: z.string().min(1).optional(),
  input: EvalCaseInputSchema.optional(),
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
  message: 'give exactly one of agentRunId (harvest a production run) or input (a written case)',
});

/** Propose a new version of the step's Evaluation Brief. */
export const ProposeBriefToolSchema = z.object({
  text: z.string().min(1).max(4000),
});

/** Where a task-completion requirement came from (epic #1516 F1 / issue #1527). */
export const TaskCompletionRequirementSourceSchema = z.enum(['preamble', 'prompt', 'output_schema', 'skill', 'brief']);

/**
 * The check of one task-completion Evaluator: a `schema` or `code` check when
 * the requirement is mechanical, an `llm_judge` only when it takes judgement —
 * the platform renders that judge's rubric from the requirement and pins its
 * model and confidence floor.
 */
const TaskCompletionCheckSchema = z.discriminatedUnion('kind', [
  SchemaCheckSchema,
  CodeCheckSchema,
  z.object({ kind: z.literal('llm_judge') }),
]).describe(
  'The cheapest check that settles the requirement. schema: {"kind":"schema","schema":{...}} for fields present and typed — at most one per step, so put every field requirement in it, or use code once the step has one. code: {"kind":"code","runtime":"python","source":"..."} for anything a script can decide — counts, ids found in the input, allowed values, files written. llm_judge: {"kind":"llm_judge"} only when deciding it takes judgement; the platform writes its rubric from the requirement.',
);

/** One checkable thing the step's instructions ask the output to do, and the check that decides it. */
export const TaskCompletionEvaluatorSchema = z.object({
  name: AssistantEvaluatorNameSchema.describe('kebab-case, what the requirement checks (e.g. "every-ae-graded"); the platform prefixes it with task-completion-'),
  requirement: z.string().min(1).max(500),
  source: TaskCompletionRequirementSourceSchema,
  /** A miss here matters most — shown on the card and carried into a judge's rubric. */
  priority: z.literal('high').optional(),
  check: TaskCompletionCheckSchema,
});

/**
 * Draft the step's task-completion Evaluators: one Evaluator per requirement
 * of the step's instructions, each of the cheapest kind that decides it, so a
 * failure names the requirement that was missed (epic #1516 F1). Offered only
 * behind the dedicated `action: 'draft_task_completion_evaluators'` request,
 * never as a free-form proposal. Each is created like any other Evaluator,
 * with production left opt-in.
 */
export const ProposeTaskCompletionEvaluatorsToolSchema = z.object({
  evaluators: z.array(TaskCompletionEvaluatorSchema).min(1).max(20),
  /** Instructions with no testable criterion — e.g. "be thorough". */
  vagueInstructions: z.array(z.object({
    quote: z.string().min(1).max(500),
    why: z.string().min(1).max(500),
  })).max(10).default([]),
  rationale: z.string().max(1000).optional(),
}).refine((value) => new Set(value.evaluators.map((evaluator) => evaluator.name)).size === value.evaluators.length, {
  message: 'give each evaluator its own name',
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
export const ProposeEvaluatorVersionToolSchema = z.object({
  evaluatorId: z.uuid(),
  rule: z.string().min(1).max(2000).optional(),
  check: EvaluatorCheckSchema.optional(),
  /** What changed and why — a judge rationale a person denied, a preview. */
  rationale: z.string().max(1000).optional(),
}).refine((value) => value.rule !== undefined || value.check !== undefined, {
  message: 'change at least one of rule or check',
});

/** Propose a case synthesized from a production run by changing its input or workspace. */
export const ProposePerturbedCaseToolSchema = PerturbedEvalCaseSpecSchema.extend({
  rationale: z.string().max(1000).optional(),
}).refine(hasPerturbationChange, { message: 'give at least one inputChanges or fileChanges entry' });

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
  propose_evaluator: ProposeEvaluatorToolSchema,
  propose_evaluator_version: ProposeEvaluatorVersionToolSchema,
  propose_eval_case: ProposeEvalCaseToolSchema,
  propose_perturbed_case: ProposePerturbedCaseToolSchema,
  propose_brief: ProposeBriefToolSchema,
  propose_acceptance_criteria: ProposeAcceptanceCriteriaToolSchema,
  propose_control_settings: ProposeControlSettingsToolSchema,
  propose_diagnosis: ProposeDiagnosisToolSchema,
  propose_task_completion_evaluators: ProposeTaskCompletionEvaluatorsToolSchema,
} as const;

const NoArguments = z.object({});

export const EVALUATION_ASSISTANT_PLATFORM_TOOLS = {
  /**
   * The step as it runs: config, agent prompt, input/output descriptions,
   * allowed tools, effective MCP servers with their eval policy, the catalog
   * Skills it is offered with their SKILL.md, and the steps upstream of it.
   */
  get_step: NoArguments,
  /**
   * The step's instructions alone — preamble, step description, agent prompt,
   * input/output descriptions, outputSchema, and skills as name + description
   * only (no SKILL.md) — to draft task-completion Evaluators from (F1). Offered
   * only behind `action: 'draft_task_completion_evaluators'`, never in ordinary
   * conversation.
   */
  get_step_instructions: NoArguments,
  /**
   * The Agent as it runs on its own (ADR-0029): system prompt, model, runtime,
   * input/output descriptions, effective MCP servers with their eval policy and
   * the catalog Skills it is offered with their SKILL.md.
   */
  get_agent: NoArguments,
  /**
   * The Steps that use the Agent, with what each adds to it, and their recent
   * finished production Agent Runs — the input each was given and the
   * reviewer's verdict — to write the Agent's cases from.
   */
  list_agent_production_runs: z.object({ limit: z.number().int().min(1).max(50).optional() }),
  /** Recent finished production Agent Runs of the step, with the reviewer's verdict where there was one. */
  list_step_runs: z.object({ limit: z.number().int().min(1).max(50).optional() }),
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
  /** Files of the workspace an Agent Run started from — what a case from it would start from. */
  list_workspace_files: z.object({ agentRunId: z.string().min(1) }),
  /** One text file of that workspace. */
  read_workspace_file: z.object({ agentRunId: z.string().min(1), path: WorkspaceFilePathSchema }),
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
  /** Run a draft check against existing outputs; writes nothing. */
  preview_evaluator: z.object({
    check: AssistantCheckSchema,
    agentRunIds: z.array(z.string().min(1)).min(1).max(10).optional(),
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

/**
 * The only tools a `draft_task_completion_evaluators` request offers (epic
 * #1516 F1 decision B): a dedicated, narrow tool set instead of the Step's
 * ordinary one, so drafting the task-completion Evaluators stays predictable —
 * never a free-form `propose_evaluator`. A Step only.
 */
export const DRAFT_TASK_COMPLETION_EVALUATORS_TOOLSET = {
  platform: ['get_step_instructions', 'list_step_runs', 'get_agent_run', 'preview_evaluator'],
  proposals: ['propose_task_completion_evaluators'],
} as const satisfies EvaluationAssistantToolset;

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
  z.object({ tool: z.literal('propose_task_completion_evaluators'), arguments: ProposeTaskCompletionEvaluatorsToolSchema }),
]);

export type EvaluationAssistantProposal = z.infer<typeof EvaluationAssistantProposalSchema>;
export type FailureRootCause = z.infer<typeof FailureRootCauseSchema>;
export type FixKind = z.infer<typeof FixKindSchema>;
export type TaskCompletionEvaluator = z.infer<typeof TaskCompletionEvaluatorSchema>;
