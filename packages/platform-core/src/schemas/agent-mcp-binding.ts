import { z } from 'zod';

/** Headers-based auth for HTTP MCP transports. Header values support
 *  {{SECRET:name}} template syntax — resolved from workflowSecrets at
 *  writeMcpConfig time. Literal values pass through untouched. */
export const HttpHeadersAuthSchema = z.object({
  type: z.literal('headers'),
  headers: z.record(z.string(), z.string()),
}).strict();

export type HttpHeadersAuth = z.infer<typeof HttpHeadersAuthSchema>;

/** OAuth 2.0 auth for HTTP MCP transports. Token is obtained via OAuth
 *  flow (see Step 5 API) and stored per-agent per-server. Injected at
 *  writeMcpConfig time: `headerValueTemplate.replace('{token}', accessToken)`
 *  is emitted as a single header named `headerName`. Defaults produce the
 *  standard `Authorization: Bearer <token>` form. */
export const HttpOAuthAuthSchema = z.object({
  type: z.literal('oauth'),
  /** References an entry in `namespaces/{h}/oauthProviders/{provider}`. */
  provider: z.string().min(1),
  /** Header name to inject. Default: 'Authorization'. */
  headerName: z.string().min(1).default('Authorization'),
  /** Header value template. `{token}` is replaced with the access token
   *  at spawn time. Default: 'Bearer {token}'. */
  headerValueTemplate: z.string().min(1).default('Bearer {token}'),
  /** Optional scope display override (purely informational; authoritative
   *  scopes live on the provider config). */
  scopes: z.array(z.string()).optional(),
}).strict();

export type HttpOAuthAuth = z.infer<typeof HttpOAuthAuthSchema>;

/** Discriminated union of supported HTTP auth strategies. */
export const HttpAuthConfigSchema = z.discriminatedUnion('type', [
  HttpHeadersAuthSchema,
  HttpOAuthAuthSchema,
]);

export type HttpAuthConfig = z.infer<typeof HttpAuthConfigSchema>;

/** Stdio binding — must reference a curated stdio ToolCatalogEntry by id.
 *  Inline command/args are NOT accepted on bindings: that would re-open
 *  the RCE surface this refactor is closing. */
export const StdioAgentMcpBindingSchema = z.object({
  type: z.literal('stdio'),
  catalogId: z.string().min(1),
  allowedTools: z.array(z.string()).min(1).optional(),
}).strict();

export type StdioAgentMcpBinding = z.infer<typeof StdioAgentMcpBindingSchema>;

/** HTTP binding — must reference a curated HTTP ToolCatalogEntry by id.
 *  The URL and auth live on the catalog entry, so an agent can only reach
 *  servers that exist in its workspace catalog. */
export const HttpAgentMcpBindingSchema = z.object({
  type: z.literal('http'),
  catalogId: z.string().min(1),
  allowedTools: z.array(z.string()).min(1).optional(),
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

/** Curated stdio MCP server — the command the platform launches next to the
 *  agent. Env values support {{SECRET:name}} template syntax. */
export const StdioToolCatalogEntrySchema = z.object({
  id: z.string().min(1),
  type: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  description: z.string().optional(),
}).strict();

export type StdioToolCatalogEntry = z.infer<typeof StdioToolCatalogEntrySchema>;

/** Curated remote MCP server reached over HTTP. Header values support
 *  {{SECRET:name}} template syntax. */
export const HttpToolCatalogEntrySchema = z.object({
  id: z.string().min(1),
  type: z.literal('http'),
  url: z.string().url(),
  auth: HttpAuthConfigSchema.optional(),
  description: z.string().optional(),
}).strict();

export type HttpToolCatalogEntry = z.infer<typeof HttpToolCatalogEntrySchema>;

/** Workspace-curated MCP server definition, referenced by AgentMcpBinding.catalogId.
 *  A binding's `type` must match the entry's `type`. */
export const ToolCatalogEntrySchema = z.discriminatedUnion('type', [
  StdioToolCatalogEntrySchema,
  HttpToolCatalogEntrySchema,
]);

export type ToolCatalogEntry = z.infer<typeof ToolCatalogEntrySchema>;
