import { z } from 'zod';
import {
  AcceptanceCriteriaSchema,
  EvalCaseExpectationSchema,
  EvalCaseInputSchema,
  EvalCaseSplitSchema,
  EvaluatorCheckSchema,
  EvaluatorKindSchema,
  EvaluatorSchema,
  EvaluatorSeveritySchema,
  PerturbedEvalCaseSpecSchema,
  StepVariantPatchSchema,
  WorkspaceFilePathSchema,
  hasPerturbationChange,
} from './evaluation';

/**
 * The Evaluation Assistant's tools (ADR-0023 D14, D15), by what the assistant
 * may do with them.
 *
 * *Proposals* never run: the call comes back to the person as a card to
 * accept, edit or reject, and accepting goes through the same handler a
 * person's own form uses. *Platform* tools run as the person asking — reads,
 * a draft check against real outputs, and preparing an Eval Run. Nothing here
 * signs a Step Qualification, approves a check's source or labels an output:
 * D15 keeps those human, so there is no tool to call.
 */

const AssistantCheckSchema = EvaluatorCheckSchema.describe(
  'A JSON object, not a string or JSON-encoded string. For code use {"kind":"code","runtime":"python","source":"...script..."}; only source is a string. Choose schema, code or llm_judge and include that kind\'s required fields.',
).meta({ examples: [
  { kind: 'schema', schema: { required: ['findings'] } },
  {
    kind: 'code', runtime: 'python',
    source: 'import json\nwith open("/output/input.json") as handle:\n    data = json.load(handle)\nwith open("/output/result.json", "w") as handle:\n    json.dump({"passed": "findings" in data["result"]}, handle)',
  },
  { kind: 'llm_judge', model: 'anthropic/claude-sonnet-4', rubric: 'Does the result explain its findings?', choices: [{ label: 'yes', value: 1 }, { label: 'no', value: 0 }] },
] });

/** Propose an Evaluator for the step. */
export const ProposeEvaluatorToolSchema = z.object({
  name: EvaluatorSchema.shape.name,
  rule: z.string().min(1).max(2000),
  severity: EvaluatorSeveritySchema,
  check: AssistantCheckSchema,
  /** Why this check, and what its preview showed. */
  rationale: z.string().max(1000).optional(),
});

/** Propose an Eval Case: from a production Agent Run, or written out. */
export const ProposeEvalCaseToolSchema = z.object({
  name: z.string().min(1).max(200),
  agentRunId: z.string().min(1).optional(),
  input: EvalCaseInputSchema.optional(),
  expectation: EvalCaseExpectationSchema,
  notes: z.string().max(4000).optional(),
  split: EvalCaseSplitSchema.optional(),
  rationale: z.string().max(1000).optional(),
}).refine((value) => (value.agentRunId === undefined) !== (value.input === undefined), {
  message: 'give exactly one of agentRunId (harvest a production run) or input (a written case)',
});

/** Propose a new version of the step's Evaluation Brief. */
export const ProposeBriefToolSchema = z.object({
  text: z.string().min(1).max(4000),
});

/** A minimum pass rate, judged on its Wilson 95% lower bound (D10). */
const PassRateFloorSchema = z.number().min(0).max(1);

/**
 * An evaluation plan for the step: what could go wrong, the cheapest check
 * that would catch it, and the cases to try it on — plus the Acceptance
 * Criteria it suggests. `risks` is ranked by its order, highest risk first;
 * `severity` says how bad each one is. Nothing is created from a plan: each
 * check is drafted, previewed and proposed on its own.
 */
export const ProposeEvaluationPlanToolSchema = z.object({
  summary: z.string().min(1).max(2000),
  risks: z.array(z.object({
    /** What could go wrong, in the step's own terms. */
    failure: z.string().min(1).max(500),
    severity: EvaluatorSeveritySchema,
    /** Why it matters — the Brief, the step's config, what its runs show. */
    why: z.string().min(1).max(1000),
    check: z.object({ kind: EvaluatorKindSchema, rule: z.string().min(1).max(2000) }),
    /** Inputs worth running it on, in words. */
    cases: z.array(z.string().min(1).max(500)).max(5).optional(),
  })).min(1).max(12),
  acceptanceCriteria: z.object({
    critical: PassRateFloorSchema,
    major: PassRateFloorSchema,
    minor: PassRateFloorSchema,
  }),
});

/** Propose a new version of an existing Evaluator — a refined rule, rubric or severity. */
export const ProposeEvaluatorVersionToolSchema = z.object({
  evaluatorId: z.uuid(),
  rule: z.string().min(1).max(2000).optional(),
  severity: EvaluatorSeveritySchema.optional(),
  check: EvaluatorCheckSchema.optional(),
  /** What changed and why — a calibration disagreement, a preview. */
  rationale: z.string().max(1000).optional(),
}).refine((value) => value.rule !== undefined || value.severity !== undefined || value.check !== undefined, {
  message: 'change at least one of rule, severity or check',
});

/**
 * The outputs most worth a person's pass/fail label for an Evaluator — the
 * ground truth a judge is calibrated against (D9, EvalGen). The person labels
 * them; the assistant never does.
 */
export const ProposeOutputsToLabelToolSchema = z.object({
  evaluatorId: z.uuid(),
  outputs: z.array(z.object({
    agentRunId: z.string().min(1),
    /** Why this output is worth labelling. */
    why: z.string().min(1).max(300),
  })).min(1).max(20)
    .refine((outputs) => new Set(outputs.map((output) => output.agentRunId)).size === outputs.length, {
      message: 'each agentRunId once',
    }),
});

/** Propose a case synthesized from a production run by changing its input or workspace. */
export const ProposePerturbedCaseToolSchema = PerturbedEvalCaseSpecSchema.extend({
  rationale: z.string().max(1000).optional(),
}).refine(hasPerturbationChange, { message: 'give at least one inputChanges or fileChanges entry' });

/**
 * Propose the step's Acceptance Criteria (D10): per severity, the minimum pass
 * rate on its Wilson 95% lower bound, and optionally a minimum pass^k. Set
 * before the Eval Runs judged against them; accepting writes a new version.
 */
export const ProposeAcceptanceCriteriaToolSchema = z.object({
  criteria: AcceptanceCriteriaSchema,
  /** Why these floors: the risks behind each severity, the Brief, what a miss costs. */
  rationale: z.string().min(1).max(2000),
});

/**
 * Recommend how the step's outputs are routed after an Eval Run: `L4`
 * (Control Mode 4) above a `confidenceThreshold` (below it, `fallbackBehavior`
 * applies), or `L3` (Control Mode 3), a person reviewing every output. A recommendation card —
 * the person changes the step in the workflow editor.
 */
export const ProposeControlSettingsToolSchema = z.object({
  evalRunId: z.uuid(),
  variantId: z.string().min(1),
  autonomyLevel: z.enum(['L3', 'L4']),
  confidenceThreshold: z.number().min(0).max(1).optional(),
  /** What in the report supports it: criteria, calibration, coverage. */
  rationale: z.string().min(1).max(2000),
}).refine((value) => value.autonomyLevel === 'L3' || value.confidenceThreshold !== undefined, {
  message: 'L4 needs a confidenceThreshold',
});

export const EVALUATION_ASSISTANT_PROPOSAL_TOOLS = {
  propose_evaluation_plan: ProposeEvaluationPlanToolSchema,
  propose_evaluator: ProposeEvaluatorToolSchema,
  propose_evaluator_version: ProposeEvaluatorVersionToolSchema,
  propose_eval_case: ProposeEvalCaseToolSchema,
  propose_perturbed_case: ProposePerturbedCaseToolSchema,
  propose_outputs_to_label: ProposeOutputsToLabelToolSchema,
  propose_brief: ProposeBriefToolSchema,
  propose_acceptance_criteria: ProposeAcceptanceCriteriaToolSchema,
  propose_control_settings: ProposeControlSettingsToolSchema,
} as const;

const NoArguments = z.object({});

export const EVALUATION_ASSISTANT_PLATFORM_TOOLS = {
  /**
   * The step as it runs: config, agent prompt, input/output descriptions,
   * allowed tools, effective MCP servers with their eval policy, SKILL.md, and
   * the steps upstream of it.
   */
  get_step: NoArguments,
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
  /** An Evaluator's human labels and its latest calibration: agreement, κ, what it still needs to count. */
  get_calibration: z.object({ evaluatorId: z.uuid() }),
  list_eval_cases: NoArguments,
  list_eval_runs: NoArguments,
  /** One Eval Run's report, to explain it. */
  get_eval_run_report: z.object({ evalRunId: z.string().min(1) }),
  /** Run a draft check against existing outputs; writes nothing. */
  preview_evaluator: z.object({
    check: AssistantCheckSchema,
    agentRunIds: z.array(z.string().min(1)).min(1).max(10).optional(),
  }),
  /**
   * Prepare an Eval Run over the newest Dataset version — the step as it is,
   * and up to three challengers patched over it — which the person confirms
   * the cost of to start it.
   */
  prepare_eval_run: z.object({
    trialsPerCase: z.number().int().min(1).max(10).optional(),
    budgetUsd: z.number().positive().max(10_000).optional(),
    challengers: z.array(z.object({
      label: z.string().min(1).max(120),
      patch: StepVariantPatchSchema,
    })).max(3).optional()
      .describe('Variants to run beside the step as it is. A patch sets model, prompt, skillCommit or allowedTools, or narrows mcpRestrictions — e.g. {"label":"GPT-5","patch":{"model":"openai/gpt-5"}}.'),
  }),
  /** Each challenger of an Eval Run against the champion, Evaluator by Evaluator, with criteria, cost and routing per variant. */
  compare_variants: z.object({ evalRunId: z.string().min(1) }),
  /**
   * The step's qualification: Qualified, Stale (and what changed) or Not
   * qualified, the qualification's criteria and deviations, Evaluators changed
   * since, and the Acceptance Criteria set now.
   */
  get_qualification: NoArguments,
  /** Start a prepared Eval Run. Refused: starting needs the person's confirmation of the budget. */
  start_eval_run: z.object({ evalRunId: z.string().min(1) }),
} as const;

export type EvaluationAssistantProposalToolName = keyof typeof EVALUATION_ASSISTANT_PROPOSAL_TOOLS;
export type EvaluationAssistantPlatformToolName = keyof typeof EVALUATION_ASSISTANT_PLATFORM_TOOLS;

/** What the assistant proposed this turn, for the person to accept, edit or reject. */
export const EvaluationAssistantProposalSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('propose_evaluation_plan'), arguments: ProposeEvaluationPlanToolSchema }),
  z.object({ tool: z.literal('propose_evaluator'), arguments: ProposeEvaluatorToolSchema }),
  z.object({ tool: z.literal('propose_evaluator_version'), arguments: ProposeEvaluatorVersionToolSchema }),
  z.object({ tool: z.literal('propose_eval_case'), arguments: ProposeEvalCaseToolSchema }),
  z.object({ tool: z.literal('propose_perturbed_case'), arguments: ProposePerturbedCaseToolSchema }),
  z.object({ tool: z.literal('propose_outputs_to_label'), arguments: ProposeOutputsToLabelToolSchema }),
  z.object({ tool: z.literal('propose_brief'), arguments: ProposeBriefToolSchema }),
  z.object({ tool: z.literal('propose_acceptance_criteria'), arguments: ProposeAcceptanceCriteriaToolSchema }),
  z.object({ tool: z.literal('propose_control_settings'), arguments: ProposeControlSettingsToolSchema }),
]);

export type EvaluationAssistantProposal = z.infer<typeof EvaluationAssistantProposalSchema>;

export const EVALUATION_ASSISTANT_DEFAULT_MODEL = 'anthropic/claude-sonnet-4';
