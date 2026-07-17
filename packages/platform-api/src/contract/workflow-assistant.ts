import { z } from 'zod';
import {
  WorkflowStepSchema,
  TransitionSchema,
  AddStepToolSchema,
  UpdateStepToolSchema,
  RemoveStepToolSchema,
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

export const WorkflowAssistantToolCallSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('add_step'), arguments: AddStepToolSchema }),
  z.object({ tool: z.literal('update_step'), arguments: UpdateStepToolSchema }),
  z.object({ tool: z.literal('remove_step'), arguments: RemoveStepToolSchema }),
]);
export type WorkflowAssistantToolCall = z.infer<typeof WorkflowAssistantToolCallSchema>;

export const AskWorkflowAssistantOutputSchema = z.object({
  reply: z.string().optional(),
  toolCalls: z.array(WorkflowAssistantToolCallSchema).min(1).optional(),
});
export type AskWorkflowAssistantOutput = z.infer<typeof AskWorkflowAssistantOutputSchema>;
