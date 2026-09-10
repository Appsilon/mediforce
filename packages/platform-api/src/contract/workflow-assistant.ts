import { z } from 'zod';
import {
  WorkflowStepSchema,
  TransitionSchema,
  WorkflowAssistantToolCallSchema,
  UpdateWorkflowToolSchema,
} from '@mediforce/platform-core';

// Size caps bound a single request before it reaches OpenRouter — the whole
// canvas + history is sent each turn, so an unbounded payload is both a cost and
// a denial-of-service risk. These ceilings are generous for real authoring but
// reject pathological input.
const MAX_MESSAGE_CHARS = 20_000;
const MAX_MESSAGES = 100;
const MAX_STEPS = 200;
const MAX_TRANSITIONS = 400;

export const WorkflowAssistantMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(MAX_MESSAGE_CHARS),
});

export const AskWorkflowAssistantInputSchema = z.object({
  messages: z.array(WorkflowAssistantMessageSchema).min(1).max(MAX_MESSAGES),
  model: z.string().max(200).optional(),
  /** The saved workflow this canvas is a version of, when there is one. A
   *  trigger attaches to a registered workflow, so without this the assistant
   *  can only say what it would attach once the workflow is saved. */
  workflowName: z.string().min(1).max(200).optional(),
  workflowDefinition: z.object({
    steps: z.array(WorkflowStepSchema).max(MAX_STEPS),
    transitions: z.array(TransitionSchema).max(MAX_TRANSITIONS),
    // The workflow level, so `update_workflow` patches from what is actually
    // set rather than blind — and so the assistant can answer what the input
    // contract or the preamble currently is. Optional: a caller that only
    // edits the graph need not send it.
    settings: UpdateWorkflowToolSchema.optional(),
  }),
});
export type AskWorkflowAssistantInput = z.infer<typeof AskWorkflowAssistantInputSchema>;

/** Re-exported from platform-core so `@mediforce/platform-api/contract` consumers keep a single import site. */
export type WorkflowAssistantToolCall = z.infer<typeof WorkflowAssistantToolCallSchema>;


/**
 * The turn before the build: what the assistant intends to do, what it must ask
 * before doing it, and the phases it expects to work through.
 *
 * Split from `ask` on purpose. A build is one long request whose result appears
 * all at once, so a plan that arrives with it arrives too late to correct, and a
 * question asked inside it is a question asked after the work. Planning first
 * costs one short model call and makes both possible.
 */
export const PlanWorkflowBuildInputSchema = z.object({
  messages: z.array(WorkflowAssistantMessageSchema).min(1).max(MAX_MESSAGES),
  model: z.string().max(200).optional(),
  workflowDefinition: z.object({
    steps: z.array(WorkflowStepSchema).max(MAX_STEPS),
    transitions: z.array(TransitionSchema).max(MAX_TRANSITIONS),
    settings: UpdateWorkflowToolSchema.optional(),
  }),
});

export const PlanQuestionSchema = z.object({
  /** Stable key, so an answer can be matched back to what was asked. */
  id: z.string().min(1).max(64),
  question: z.string().min(1).max(500),
  /** What the assistant would do if the person just says "yes" — a question
   *  with no proposed answer hands the whole decision back, which is what makes
   *  interrogation tiresome. */
  recommended: z.string().min(1).max(500),
});

export const PlanWorkflowBuildOutputSchema = z.object({
  /** Two to four lines of what it is about to build, in the user's terms. */
  plan: z.array(z.string().min(1).max(300)).max(8),
  /** Only what genuinely cannot be inferred. Empty is the common case for an
   *  edit, and normal for a well-specified build. */
  questions: z.array(PlanQuestionSchema).max(5),
  /** Phases this particular build will go through, for the pane to show while
   *  it runs. Indicative, not live progress: the build is one request, so these
   *  are what the model expects to do, written for this workflow rather than
   *  the generic list they replace. */
  phases: z.array(z.string().min(1).max(60)).max(8),
});

export type PlanWorkflowBuildInput = z.infer<typeof PlanWorkflowBuildInputSchema>;
export type PlanWorkflowBuildOutput = z.infer<typeof PlanWorkflowBuildOutputSchema>;
export type PlanQuestion = z.infer<typeof PlanQuestionSchema>;

export const AskWorkflowAssistantOutputSchema = z.object({
  reply: z.string().optional(),
  toolCalls: z.array(WorkflowAssistantToolCallSchema).min(1).optional(),
  /** Set when the build could not finish on its own. The assistant asks rather
   *  than failing: an error toast tells someone their turn is gone, a question
   *  with a recommended answer lets them finish it. Same shape as the planning
   *  turn's, so the pane renders one card for both. */
  questions: z.array(PlanQuestionSchema).max(3).optional(),
});
export type AskWorkflowAssistantOutput = z.infer<typeof AskWorkflowAssistantOutputSchema>;
