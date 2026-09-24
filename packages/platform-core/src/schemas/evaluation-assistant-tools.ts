import { z } from 'zod';
import {
  EvalCaseExpectationSchema,
  EvalCaseInputSchema,
  EvalCaseSplitSchema,
  EvaluatorCheckSchema,
  EvaluatorSchema,
  EvaluatorSeveritySchema,
} from './evaluation';

/**
 * The Evaluation Assistant's tools (ADR-0023 D14, D15), by what the assistant
 * may do with them.
 *
 * *Proposals* never run: the call comes back to the person as a card to
 * accept, edit or reject, and accepting goes through the same handler a
 * person's own form uses. *Platform* tools run as the person asking — reads,
 * a draft check against real outputs, and preparing an Eval Run. Nothing here
 * signs, approves a check's source or labels an output: D15 keeps those human,
 * so there is no tool to call.
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

export const EVALUATION_ASSISTANT_PROPOSAL_TOOLS = {
  propose_evaluator: ProposeEvaluatorToolSchema,
  propose_eval_case: ProposeEvalCaseToolSchema,
  propose_brief: ProposeBriefToolSchema,
} as const;

const NoArguments = z.object({});

export const EVALUATION_ASSISTANT_PLATFORM_TOOLS = {
  /** The step as it runs: config, agent prompt and MCP servers with their eval policy, SKILL.md. */
  get_step: NoArguments,
  /** Recent finished production Agent Runs of the step. */
  list_step_runs: z.object({ limit: z.number().int().min(1).max(20).optional() }),
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
  list_evaluators: NoArguments,
  list_eval_cases: NoArguments,
  list_eval_runs: NoArguments,
  /** One Eval Run's report, to explain it. */
  get_eval_run_report: z.object({ evalRunId: z.string().min(1) }),
  /** Run a draft check against existing outputs; writes nothing. */
  preview_evaluator: z.object({
    check: AssistantCheckSchema,
    agentRunIds: z.array(z.string().min(1)).min(1).max(10).optional(),
  }),
  /** Prepare an Eval Run over the newest Dataset version; the person confirms its cost to start it. */
  prepare_eval_run: z.object({
    trialsPerCase: z.number().int().min(1).max(10).optional(),
    budgetUsd: z.number().positive().max(10_000).optional(),
  }),
  /** Start a prepared Eval Run. Refused: starting needs the person's confirmation of the budget. */
  start_eval_run: z.object({ evalRunId: z.string().min(1) }),
} as const;

export type EvaluationAssistantProposalToolName = keyof typeof EVALUATION_ASSISTANT_PROPOSAL_TOOLS;
export type EvaluationAssistantPlatformToolName = keyof typeof EVALUATION_ASSISTANT_PLATFORM_TOOLS;

/** What the assistant proposed this turn, for the person to accept, edit or reject. */
export const EvaluationAssistantProposalSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('propose_evaluator'), arguments: ProposeEvaluatorToolSchema }),
  z.object({ tool: z.literal('propose_eval_case'), arguments: ProposeEvalCaseToolSchema }),
  z.object({ tool: z.literal('propose_brief'), arguments: ProposeBriefToolSchema }),
]);

export type EvaluationAssistantProposal = z.infer<typeof EvaluationAssistantProposalSchema>;

export const EVALUATION_ASSISTANT_DEFAULT_MODEL = 'anthropic/claude-sonnet-4';
