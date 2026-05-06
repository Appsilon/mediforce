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

/** Catalog-ref binding — points at a ToolCatalogEntry that carries its
 *  own transport (http or stdio) and optionally a Connection for auth.
 *  Replaces both inline http and the stdio-only catalogId binding in the
 *  long term; for PR A both old shapes (`type: 'stdio'`, `type: 'http'`)
 *  remain accepted for read-compatibility. New writes should prefer this
 *  shape. */
export const CatalogRefAgentMcpBindingSchema = z.object({
  type: z.literal('catalog'),
  catalogId: z.string().min(1),
  allowedTools: z.array(z.string()).min(1).optional(),
}).strict();

export type CatalogRefAgentMcpBinding = z.infer<typeof CatalogRefAgentMcpBindingSchema>;

/** Discriminated union of supported MCP transports at the agent level.
 *  `'catalog'` is the new canonical variant introduced for PR A; `'stdio'`
 *  and `'http'` are kept for backward read-compatibility while the data
 *  store still contains legacy bindings. */
export const AgentMcpBindingSchema = z.discriminatedUnion('type', [
  StdioAgentMcpBindingSchema,
  HttpAgentMcpBindingSchema,
  CatalogRefAgentMcpBindingSchema,
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

/** HTTP transport on a ToolCatalogEntry. Auth is supplied by the entry's
 *  `connectionId` (resolved at consumer time), not inlined here. */
export const HttpMcpExposureSchema = z.object({
  type: z.literal('http'),
  url: z.string().url(),
}).strict();

export type HttpMcpExposure = z.infer<typeof HttpMcpExposureSchema>;

/** Stdio transport on a ToolCatalogEntry. `extraEnv` carries non-credential
 *  config (workspace ids, regions, default flags); credentials should live
 *  on a Connection referenced via `connectionId`. `extraEnv` continues to
 *  support `{{SECRET:name}}` template interpolation for legacy compatibility,
 *  but the convention is: credentials → Connection, non-creds → extraEnv. */
export const StdioMcpExposureSchema = z.object({
  type: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  extraEnv: z.record(z.string(), z.string()).optional(),
}).strict();

export type StdioMcpExposure = z.infer<typeof StdioMcpExposureSchema>;

export const McpExposureSchema = z.discriminatedUnion('type', [
  HttpMcpExposureSchema,
  StdioMcpExposureSchema,
]);

export type McpExposure = z.infer<typeof McpExposureSchema>;

/** Admin-curated MCP server definition, referenced by `AgentMcpBinding`
 *  (via `catalogId`).
 *
 *  PR A keeps both shapes parseable so the same Firestore document store
 *  serves legacy reads and new writes:
 *
 *    Legacy stdio shape (existing rows):
 *      { id, command, args?, env?, description? }
 *
 *    New shape (preferred for writes; PR B will migrate legacy to this):
 *      { id, name?, description?, connectionId?, mcp: HttpMcpExposure | StdioMcpExposure }
 *
 *  At least one of `command` (legacy) or `mcp` (new) must be present.
 *  Resolvers should call `getCatalogEntryStdio` / `getCatalogEntryHttp`
 *  helpers (this file) to read transport details without branching on
 *  shape. */
/** Bare object schema for ToolCatalogEntry — exposed so callers can apply
 *  `.omit()` / `.partial()` (e.g. PATCH payloads). The exported
 *  `ToolCatalogEntrySchema` is this shape with the cross-field refinement
 *  attached, but `.refine()` returns ZodEffects which Zod refuses to
 *  `.omit()`. Use this base when you need shape mutations and the
 *  refinement when you need full validation. */
export const ToolCatalogEntryBaseSchema = z.object({
  id: z.string().min(1),
  // Legacy stdio fields. Optional now so new entries can omit them in
  // favour of `mcp`; existing rows that only carry these still parse.
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  // Shared metadata.
  name: z.string().optional(),
  description: z.string().optional(),
  // New fields.
  connectionId: z.string().min(1).optional(),
  mcp: McpExposureSchema.optional(),
}).strict();

export const ToolCatalogEntrySchema = ToolCatalogEntryBaseSchema.refine(
  (entry) => entry.command !== undefined || entry.mcp !== undefined,
  {
    message: 'tool catalog entry must have either `command` (legacy stdio) or `mcp` (new shape)',
  },
);

export type ToolCatalogEntry = z.infer<typeof ToolCatalogEntrySchema>;

/** Pull stdio launch fields from a catalog entry, regardless of whether
 *  it uses the legacy top-level shape or the new `mcp.stdio` shape.
 *  Returns null when the entry does not expose an stdio transport. */
export function getCatalogEntryStdio(
  entry: ToolCatalogEntry,
): { command: string; args?: string[]; env?: Record<string, string> } | null {
  if (entry.mcp !== undefined) {
    if (entry.mcp.type !== 'stdio') return null;
    return {
      command: entry.mcp.command,
      args: entry.mcp.args,
      env: entry.mcp.extraEnv,
    };
  }
  if (entry.command !== undefined) {
    return { command: entry.command, args: entry.args, env: entry.env };
  }
  return null;
}

/** Pull http exposure URL from a catalog entry. Returns null when the
 *  entry does not expose an http transport (legacy entries never do). */
export function getCatalogEntryHttp(entry: ToolCatalogEntry): { url: string } | null {
  if (entry.mcp?.type !== 'http') return null;
  return { url: entry.mcp.url };
}
