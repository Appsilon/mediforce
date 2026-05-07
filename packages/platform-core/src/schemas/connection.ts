import { z } from 'zod';

/** OAuth-flavoured Connection auth.
 *
 *  Token fields are optional so a Connection can exist in a "not yet connected"
 *  state — the admin creates it (id, name, providerId), then later clicks
 *  Connect to fill `accessToken` etc. via the OAuth flow callback.
 *
 *  `expiresAt` is unix ms to match the existing AgentOAuthToken shape (lets
 *  PR B migration copy values across without conversion). */
export const ConnectionOAuthAuthSchema = z.object({
  type: z.literal('oauth'),
  /** References `namespaces/{h}/oauthProviders/{providerId}`. */
  providerId: z.string().min(1),
  accessToken: z.string().min(1).optional(),
  refreshToken: z.string().min(1).optional(),
  /** Unix ms of access token expiry. Absent → treat as long-lived
   *  (GitHub OAuth Apps default). */
  expiresAt: z.number().int().positive().optional(),
  /** Space-separated scopes granted by the provider. */
  scope: z.string().optional(),
  /** Stable provider-side user id (GitHub: numeric, Google: `sub`). */
  providerUserId: z.string().optional(),
  /** Display-friendly account identifier (GitHub: `@login`, Google: email). */
  accountLogin: z.string().optional(),
  /** Unix ms when the token was persisted (initial or last refresh). */
  connectedAt: z.number().int().positive().optional(),
  /** Firebase uid of the user who initiated the connect. Audit only. */
  connectedBy: z.string().optional(),
}).strict();

export type ConnectionOAuthAuth = z.infer<typeof ConnectionOAuthAuthSchema>;

/** Header-bag auth — subsumes the legacy single-secret case. Header values
 *  support `{{SECRET:name}}` template syntax resolved against WorkflowSecrets
 *  at consumer time. Use this for any non-OAuth API: static API keys,
 *  HMAC signatures, custom Authorization schemes, multiple required headers. */
export const ConnectionHeadersAuthSchema = z.object({
  type: z.literal('headers'),
  headers: z.record(z.string().min(1), z.string()),
}).strict();

export type ConnectionHeadersAuth = z.infer<typeof ConnectionHeadersAuthSchema>;

export const ConnectionAuthSchema = z.discriminatedUnion('type', [
  ConnectionOAuthAuthSchema,
  ConnectionHeadersAuthSchema,
]);

export type ConnectionAuth = z.infer<typeof ConnectionAuthSchema>;

/** Connection id pattern. POSIX env-var safe after hyphen-to-underscore
 *  normalization (`github-mediforce` → `CONN_GITHUB_MEDIFORCE_TOKEN`).
 *  Lowercase + digits + dashes, must start with a letter. */
export const CONNECTION_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export const ConnectionSchema = z.object({
  id: z.string().min(1).regex(CONNECTION_ID_PATTERN, {
    message: 'id must be lowercase letters, digits, or dashes (starting with a letter)',
  }),
  name: z.string().min(1),
  description: z.string().optional(),
  auth: ConnectionAuthSchema,
  /** ISO timestamp of creation. */
  createdAt: z.string().datetime(),
  /** ISO timestamp of last update. */
  updatedAt: z.string().datetime(),
}).strict();

export type Connection = z.infer<typeof ConnectionSchema>;

/** Public slice for UI display — strips token material from oauth auth. */
export const PublicConnectionSchema = ConnectionSchema.transform((conn) => {
  if (conn.auth.type !== 'oauth') return conn;
  const { accessToken: _accessToken, refreshToken: _refreshToken, ...auth } = conn.auth;
  return { ...conn, auth };
});

export type PublicConnection = z.infer<typeof PublicConnectionSchema>;

/** Auth shape accepted on `create` and `patch` — drops every field that
 *  carries token material so the OAuth flow remains the only writer of
 *  tokens. Admins can still attach an oauth-typed Connection (providerId)
 *  or a headers Connection (header bag); they cannot plant an
 *  `accessToken` directly via REST. */
const CreatableOAuthAuthSchema = ConnectionOAuthAuthSchema.omit({
  accessToken: true,
  refreshToken: true,
  expiresAt: true,
  scope: true,
  providerUserId: true,
  accountLogin: true,
  connectedAt: true,
  connectedBy: true,
});

const CreatableConnectionAuthSchema = z.discriminatedUnion('type', [
  CreatableOAuthAuthSchema,
  ConnectionHeadersAuthSchema,
]);

/** Input for creating a Connection. Server fills `createdAt`/`updatedAt`.
 *  Token fields are stripped from the auth shape — only the OAuth callback
 *  (via `setTokens`) may write them. */
export const CreateConnectionInputSchema = ConnectionSchema.omit({
  createdAt: true,
  updatedAt: true,
  auth: true,
}).extend({ auth: CreatableConnectionAuthSchema });

export type CreateConnectionInput = z.infer<typeof CreateConnectionInputSchema>;

/** Patch input — same token-stripping as create. */
export const UpdateConnectionInputSchema = CreateConnectionInputSchema
  .omit({ id: true })
  .partial();

export type UpdateConnectionInput = z.infer<typeof UpdateConnectionInputSchema>;

/** Tokens written by the OAuth callback. Mirrors the OAuth provider's
 *  successful exchange response — repo's `setTokens` accepts this shape. */
export const ConnectionTokenUpdateSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  expiresAt: z.number().int().positive().optional(),
  scope: z.string().optional(),
  providerUserId: z.string().optional(),
  accountLogin: z.string().optional(),
  connectedBy: z.string().optional(),
}).strict();

export type ConnectionTokenUpdate = z.infer<typeof ConnectionTokenUpdateSchema>;

/** Map a Connection id to the canonical `CONN_<NORMALIZED>_TOKEN` env var
 *  name. Hyphens become underscores so the result is a valid POSIX
 *  identifier. The input must already match `CONNECTION_ID_PATTERN`
 *  (every persisted Connection does); arbitrary strings are rejected at
 *  runtime so a malformed env name can never reach a child process. */
export function connectionTokenEnvName(connectionId: string): string {
  if (!CONNECTION_ID_PATTERN.test(connectionId)) {
    throw new Error(
      `connectionTokenEnvName: id "${connectionId}" does not match CONNECTION_ID_PATTERN`,
    );
  }
  return `CONN_${connectionId.replace(/-/g, '_').toUpperCase()}_TOKEN`;
}
