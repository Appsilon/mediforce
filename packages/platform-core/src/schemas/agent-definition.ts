import { z } from 'zod';
import { AgentMcpBindingMapSchema } from './agent-mcp-binding.js';
import { AgentSkillRefSchema } from './skill-registry.js';

export const AgentVisibilitySchema = z.enum(['public', 'private']);
export type AgentVisibility = z.infer<typeof AgentVisibilitySchema>;

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
  /** Registry-first skill bindings: each entry resolves to a folder under
   *  `<registry.repo>/<registry.skillsDir>/<name>/` containing SKILL.md
   *  + references/ + scripts. Assembled into a per-run plugin tree by the
   *  agent runtime. */
  skills: z.array(AgentSkillRefSchema).default([]),
  /** Canonical MCP server configuration for this agent. Map of server
   *  name → AgentMcpBinding. Step-level restrictions can only narrow
   *  (disable servers or deny tools) — they cannot broaden. */
  mcpServers: AgentMcpBindingMapSchema.optional(),
  namespace: z.string().min(1).optional(),
  visibility: AgentVisibilitySchema.default('private'),
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
