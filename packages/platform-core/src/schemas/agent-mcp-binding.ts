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

/** Normalizes legacy HTTP auth shapes into the discriminated form.
 *  Pre-Step 5, bindings stored `{ headers: {...} }` without a `type`
 *  discriminator. After this step, all authed HTTP bindings must carry
 *  `type: 'headers' | 'oauth'`. Lazy read-time migration: legacy shapes
 *  are normalized here, writes always emit the new form. */
function normalizeLegacyAuth(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val !== 'object') return val;
  const record = val as Record<string, unknown>;
  if ('type' in record) return val;
  if ('headers' in record && record.headers !== null && record.headers !== undefined) {
    return { type: 'headers', headers: record.headers };
  }
  // Empty legacy object (`{}` or `{ headers: undefined }`) carried no auth
  // intent — drop it so the field becomes undefined.
  return undefined;
}

/** Stdio binding — must reference a curated ToolCatalogEntry by id.
 *  Inline command/args are NOT accepted on bindings: that would re-open
 *  the RCE surface this refactor is closing. */
export const StdioAgentMcpBindingSchema = z.object({
  type: z.literal('stdio'),
  catalogId: z.string().min(1),
  allowedTools: z.array(z.string()).min(1).optional(),
}).strict();

export type StdioAgentMcpBinding = z.infer<typeof StdioAgentMcpBindingSchema>;

/** HTTP binding — free-form URL. Domain allowlist validation arrives
 *  in Step 2 (not enforced at schema level). */
export const HttpAgentMcpBindingSchema = z.object({
  type: z.literal('http'),
  url: z.string().url(),
  allowedTools: z.array(z.string()).min(1).optional(),
  auth: z.preprocess(normalizeLegacyAuth, HttpAuthConfigSchema.optional()),
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
