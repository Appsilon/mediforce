import { z } from 'zod';
import { AgentMcpBindingMapSchema } from './agent-mcp-binding';

// Tools the assistant runs against the platform itself rather than the canvas.

/** Which secret keys this workspace has. Names only: a value never enters the
 *  conversation, which is the whole point of a secret. */
export const ListSecretsToolSchema = z.object({});
export type ListSecretsTool = z.infer<typeof ListSecretsToolSchema>;

/** The agents a step can point at with `agentId`. */
export const ListAgentsToolSchema = z.object({});
export type ListAgentsTool = z.infer<typeof ListAgentsToolSchema>;

/** The MCP servers in this workspace's Tool Catalog, which an agent binds to. */
export const ListToolCatalogToolSchema = z.object({});
export type ListToolCatalogTool = z.infer<typeof ListToolCatalogToolSchema>;

// Create an agent a step can then use.
export const CreateAgentToolSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  systemPrompt: z.string().min(1),
  foundationModel: z.string().min(1),
  inputDescription: z.string().min(1),
  outputDescription: z.string().min(1),
  /** MCP servers this agent may use, by Tool Catalog name. */
  mcpServers: AgentMcpBindingMapSchema.optional(),
});
export type CreateAgentTool = z.infer<typeof CreateAgentToolSchema>;

// Add an MCP server to the workspace's Tool Catalog, so an agent can bind to it.
export const CreateToolCatalogEntryToolSchema = z.object({
  /** Stable name bindings reference. Derived from the command when omitted. */
  id: z.string().min(1).optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  /** Environment for the server process. Values may name a workspace secret as
   *  `{{KEY}}`; never write a secret's value here. */
  env: z.record(z.string(), z.string()).optional(),
  description: z.string().optional(),
});
export type CreateToolCatalogEntryTool = z.infer<typeof CreateToolCatalogEntryToolSchema>;

// Put this workflow on a schedule.
export const CreateCronTriggerToolSchema = z.object({
  // Standard five-field cron, e.g.
  schedule: z.string().min(1),
  // Names the row, so a workflow can carry more than one schedule.
  name: z.string().min(1).max(100).optional(),
  // The static input every tick hands the run.
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type CreateCronTriggerTool = z.infer<typeof CreateCronTriggerToolSchema>;

// Which roles this workspace actually grants, and how many people hold each.
export const ListRolesToolSchema = z.object({});
export type ListRolesTool = z.infer<typeof ListRolesToolSchema>;

export const WORKFLOW_ASSISTANT_PLATFORM_TOOLS = {
  create_cron_trigger: CreateCronTriggerToolSchema,
  list_roles: ListRolesToolSchema,
  list_secrets: ListSecretsToolSchema,
  list_agents: ListAgentsToolSchema,
  list_tool_catalog: ListToolCatalogToolSchema,
  create_agent: CreateAgentToolSchema,
  create_tool_catalog_entry: CreateToolCatalogEntryToolSchema,
} as const;

export type WorkflowAssistantPlatformToolName = keyof typeof WORKFLOW_ASSISTANT_PLATFORM_TOOLS;

export function isPlatformToolName(name: string): name is WorkflowAssistantPlatformToolName {
  return name in WORKFLOW_ASSISTANT_PLATFORM_TOOLS;
}
