import { z } from 'zod';
import { AgentDefinitionSchema, UpdateAgentDefinitionInputSchema } from '@mediforce/platform-core';

/** Reserved for future filters (e.g. visibility, namespace). */
export const ListAgentsInputSchema = z.object({});

export const ListAgentsOutputSchema = z.object({
  agents: z.array(AgentDefinitionSchema),
});

export const GetAgentInputSchema = z.object({
  id: z.string().min(1),
});

export const GetAgentOutputSchema = z.object({
  agent: AgentDefinitionSchema,
});

export const DeleteAgentInputSchema = z.object({
  id: z.string().min(1),
});

export const DeleteAgentOutputSchema = z.object({
  success: z.literal(true),
});

export const UpdateAgentInputSchema = z.object({
  id: z.string().min(1),
});

export const UpdateAgentBodySchema = UpdateAgentDefinitionInputSchema;

export const UpdateAgentOutputSchema = z.object({
  agent: AgentDefinitionSchema,
});

export type ListAgentsInput = z.infer<typeof ListAgentsInputSchema>;
export type ListAgentsOutput = z.infer<typeof ListAgentsOutputSchema>;
export type GetAgentInput = z.infer<typeof GetAgentInputSchema>;
export type GetAgentOutput = z.infer<typeof GetAgentOutputSchema>;
export type DeleteAgentInput = z.infer<typeof DeleteAgentInputSchema>;
export type DeleteAgentOutput = z.infer<typeof DeleteAgentOutputSchema>;
export type UpdateAgentInput = z.infer<typeof UpdateAgentInputSchema>;
export type UpdateAgentBody = z.infer<typeof UpdateAgentBodySchema>;
export type UpdateAgentOutput = z.infer<typeof UpdateAgentOutputSchema>;
