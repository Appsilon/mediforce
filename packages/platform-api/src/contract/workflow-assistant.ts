import { z } from 'zod';
import {
  WorkflowStepSchema,
  TransitionSchema,
  WorkflowAssistantToolCallSchema,
} from '@mediforce/platform-core';

export const WorkflowAssistantMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

export const AskWorkflowAssistantInputSchema = z.object({
  messages: z.array(WorkflowAssistantMessageSchema).min(1),
  model: z.string().optional(),
  workflowDefinition: z.object({
    steps: z.array(WorkflowStepSchema),
    transitions: z.array(TransitionSchema),
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
