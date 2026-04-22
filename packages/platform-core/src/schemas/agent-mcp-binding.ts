import { z } from 'zod';

/** Auth config for HTTP MCP transports. Header values support
 *  {{SECRET:name}} (resolved at writeMcpConfig time) and, once Step 4
 *  lands, {{OAUTH:provider}} template injection. */
export const HttpAuthConfigSchema = z.object({
  headers: z.record(z.string(), z.string()).optional(),
}).strict();

export type HttpAuthConfig = z.infer<typeof HttpAuthConfigSchema>;

/** Stdio binding — must reference a curated ToolCatalogEntry by id.
 *  Inline command/args are NOT accepted on bindings: that would re-open
 *  the RCE surface this refactor is closing. */
export const StdioAgentMcpBindingSchema = z.object({
  type: z.literal('stdio'),
  catalogId: z.string().min(1),
  allowedTools: z.array(z.string()).optional(),
}).strict();

export type StdioAgentMcpBinding = z.infer<typeof StdioAgentMcpBindingSchema>;

/** HTTP binding — free-form URL. Domain allowlist validation arrives
 *  in Step 2 (not enforced at schema level). */
export const HttpAgentMcpBindingSchema = z.object({
  type: z.literal('http'),
  url: z.string().url(),
  allowedTools: z.array(z.string()).optional(),
  auth: HttpAuthConfigSchema.optional(),
}).strict();

export type HttpAgentMcpBinding = z.infer<typeof HttpAgentMcpBindingSchema>;

/** Discriminated union of supported MCP transports at the agent level. */
export const AgentMcpBindingSchema = z.discriminatedUnion('type', [
  StdioAgentMcpBindingSchema,
  HttpAgentMcpBindingSchema,
]);

export type AgentMcpBinding = z.infer<typeof AgentMcpBindingSchema>;

/** Map of MCP server name → binding, attached to an AgentDefinition. */
export const AgentMcpBindingMapSchema = z.record(z.string().min(1), AgentMcpBindingSchema);

export type AgentMcpBindingMap = z.infer<typeof AgentMcpBindingMapSchema>;

/** Step-level restriction for a single MCP server. Subtractive only —
 *  there is intentionally no `allowTools` field: the shape itself makes
 *  broadening the agent's allowlist impossible. */
export const StepMcpRestrictionEntrySchema = z.object({
  disable: z.boolean().optional(),
  denyTools: z.array(z.string()).optional(),
}).strict();

export type StepMcpRestrictionEntry = z.infer<typeof StepMcpRestrictionEntrySchema>;

/** Map of MCP server name → restriction, attached to a WorkflowStep. */
export const StepMcpRestrictionSchema = z.record(z.string().min(1), StepMcpRestrictionEntrySchema);

export type StepMcpRestriction = z.infer<typeof StepMcpRestrictionSchema>;

/** Admin-curated stdio MCP server definition, referenced by AgentMcpBinding.catalogId.
 *  Env values support {{SECRET:name}} template syntax. */
export const ToolCatalogEntrySchema = z.object({
  id: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  description: z.string().optional(),
}).strict();

export type ToolCatalogEntry = z.infer<typeof ToolCatalogEntrySchema>;
