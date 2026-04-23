import { z } from 'zod';

/** OAuth token persisted per (namespace, agentId, serverName). One token
 *  per agent+server binding — if two agents both need GitHub, the user
 *  connects twice (separate tokens) by design. */
export const AgentOAuthTokenSchema = z.object({
  /** Provider id (references `namespaces/{h}/oauthProviders/{providerId}`). */
  provider: z.string().min(1),
  /** Access token — presented to the MCP server at spawn time. */
  accessToken: z.string().min(1),
  /** Refresh token, if the provider issues one. Present iff the provider
   *  supports `access_type=offline` (Google) or long-lived refresh
   *  (GitHub Device Flow). Absence → manual reconnect on expiry. */
  refreshToken: z.string().optional(),
  /** Unix ms when the access token expires. Absent → treat as long-lived. */
  expiresAt: z.number().int().positive().optional(),
  /** Space-separated scopes granted by the provider (may differ from what
   *  we requested — GitHub in particular narrows on user consent). */
  scope: z.string(),
  /** Stable provider-side user id. GitHub: numeric id. Google: `sub` claim. */
  providerUserId: z.string().min(1),
  /** Display-friendly account identifier. GitHub: `@login`. Google: email. */
  accountLogin: z.string().min(1),
  /** Unix ms when the token was persisted (initial or last refresh). */
  connectedAt: z.number().int().positive(),
  /** Firebase uid of the user who initiated the connect. Audit trail. */
  connectedBy: z.string().min(1),
}).strict();

export type AgentOAuthToken = z.infer<typeof AgentOAuthTokenSchema>;

/** Public slice for UI display — excludes the tokens themselves. */
export const PublicAgentOAuthTokenSchema = AgentOAuthTokenSchema.omit({
  accessToken: true,
  refreshToken: true,
});

export type PublicAgentOAuthToken = z.infer<typeof PublicAgentOAuthTokenSchema>;
