import { z } from 'zod';

export const AgentDefinitionSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  iconName: z.string(),
  description: z.string(),
  foundationModel: z.string(),
  systemPrompt: z.string(),
  skillFileNames: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;
