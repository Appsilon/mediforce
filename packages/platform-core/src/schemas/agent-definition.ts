import { z } from 'zod';

export const AgentDefinitionSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  iconName: z.string(),
  description: z.string(),
  foundationModel: z.string(),
  systemPrompt: z.string(),
  inputDescription: z.string(),
  outputDescription: z.string(),
  skillFileNames: z.array(z.string()),
  pluginId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

export const CreateAgentDefinitionInputSchema = AgentDefinitionSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const UpdateAgentDefinitionInputSchema = CreateAgentDefinitionInputSchema.partial();

export type CreateAgentDefinitionInput = z.infer<typeof CreateAgentDefinitionInputSchema>;
export type UpdateAgentDefinitionInput = z.infer<typeof UpdateAgentDefinitionInputSchema>;
