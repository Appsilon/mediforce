import { z } from 'zod';
import { AgentDefinitionSchema } from '@mediforce/platform-core';

export const ListAgentsOutputSchema = z.object({
  agents: z.array(AgentDefinitionSchema),
});

export const GetAgentInputSchema = z.object({
  id: z.string().min(1),
});

export const GetAgentOutputSchema = z.object({
  agent: AgentDefinitionSchema,
});

export type ListAgentsOutput = z.infer<typeof ListAgentsOutputSchema>;
export type GetAgentInput = z.infer<typeof GetAgentInputSchema>;
export type GetAgentOutput = z.infer<typeof GetAgentOutputSchema>;
