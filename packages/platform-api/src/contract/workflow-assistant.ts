import { z } from 'zod';
import {
  WorkflowStepSchema,
  TransitionSchema,
  WorkflowAssistantToolCallSchema,
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
  workflowDefinition: z.object({
    steps: z.array(WorkflowStepSchema).max(MAX_STEPS),
    transitions: z.array(TransitionSchema).max(MAX_TRANSITIONS),
  }),
});
export type AskWorkflowAssistantInput = z.infer<typeof AskWorkflowAssistantInputSchema>;

/** Re-exported from platform-core so `@mediforce/platform-api/contract` consumers keep a single import site. */
export type WorkflowAssistantToolCall = z.infer<typeof WorkflowAssistantToolCallSchema>;

export const AskWorkflowAssistantOutputSchema = z.object({
  reply: z.string().optional(),
  toolCalls: z.array(WorkflowAssistantToolCallSchema).min(1).optional(),
});
export type AskWorkflowAssistantOutput = z.infer<typeof AskWorkflowAssistantOutputSchema>;
