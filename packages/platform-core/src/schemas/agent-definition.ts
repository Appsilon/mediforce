import { z } from 'zod';
import { AgentMcpBindingMapSchema } from './agent-mcp-binding.js';

export const AgentDefinitionSchema = z.object({
  id: z.string(),
  /** Discriminates runtime dispatch. 'plugin' routes to PluginRegistry
   *  (container agent). 'cowork' routes to the cowork session runtime
   *  (chat/voice widget with human-in-the-loop). */
  kind: z.enum(['plugin', 'cowork']).default('plugin'),
  /** Runtime implementation identifier. For kind='plugin' this is a
   *  PluginRegistry key (e.g. 'claude-code-agent'). For kind='cowork'
   *  this is a cowork runtime key (e.g. 'chat', 'voice-realtime'). */
  runtimeId: z.string().optional(),
  name: z.string().min(1),
  iconName: z.string(),
  description: z.string(),
  foundationModel: z.string(),
  systemPrompt: z.string(),
  inputDescription: z.string(),
  outputDescription: z.string(),
  skillFileNames: z.array(z.string()),
  /** Canonical MCP server configuration for this agent. Map of server
   *  name → AgentMcpBinding. Step-level restrictions can only narrow
   *  (disable servers or deny tools) — they cannot broaden. */
  mcpServers: AgentMcpBindingMapSchema.optional(),
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
