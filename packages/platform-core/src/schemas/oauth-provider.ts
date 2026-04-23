import { z } from 'zod';

/** Namespace-scoped OAuth provider configuration. Admins register their
 *  OAuth App at the provider (GitHub/Google/custom) with a platform-wide
 *  callback URL (`/api/oauth/:provider/callback`) and enter the resulting
 *  credentials here. Step 5 state HMAC carries `namespace` + `providerId`
 *  so the callback handler looks up the right config. */
export const OAuthProviderConfigSchema = z.object({
  /** Slug identifier; becomes the Firestore doc id. URL-safe. */
  id: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/, {
    message: 'id must be lowercase letters, digits, or dashes (starting with letter/digit)',
  }),
  /** Display name (e.g. "GitHub", "Google Drive"). */
  name: z.string().min(1),
  /** OAuth App client id. */
  clientId: z.string().min(1),
  /** OAuth App client secret. Stored plaintext in Firestore (encryption-at-rest). */
  clientSecret: z.string().min(1),
  /** Provider authorize URL (user consent screen). */
  authorizeUrl: z.string().url(),
  /** Provider token exchange URL (POST code → access/refresh tokens). */
  tokenUrl: z.string().url(),
  /** Provider token revoke URL. Optional — if set, DELETE `/api/agents/.../oauth/...`
   *  with revokeAtProvider=true hits this endpoint. */
  revokeUrl: z.string().url().optional(),
  /** User info URL. Called after token exchange to capture providerUserId +
   *  accountLogin for display. Expected shape: JSON with `{id, login?|email?}`. */
  userInfoUrl: z.string().url(),
  /** OAuth scopes requested at authorize time. Space-separated at request,
   *  stored here as an array for editability. */
  scopes: z.array(z.string().min(1)).min(1),
  /** Optional icon URL (shown in provider dropdown). */
  iconUrl: z.string().url().optional(),
  /** ISO timestamp of creation. */
  createdAt: z.string().datetime(),
  /** ISO timestamp of last update. */
  updatedAt: z.string().datetime(),
}).strict();

export type OAuthProviderConfig = z.infer<typeof OAuthProviderConfigSchema>;

/** Public-facing slice of provider config — excludes client secret. Used by
 *  UI endpoints that surface provider metadata without leaking creds. */
export const PublicOAuthProviderConfigSchema = OAuthProviderConfigSchema.omit({
  clientSecret: true,
});

export type PublicOAuthProviderConfig = z.infer<typeof PublicOAuthProviderConfigSchema>;

/** Input for `POST /api/admin/oauth-providers`. Excludes server-managed
 *  fields (createdAt, updatedAt). */
export const CreateOAuthProviderInputSchema = OAuthProviderConfigSchema.omit({
  createdAt: true,
  updatedAt: true,
});

export type CreateOAuthProviderInput = z.infer<typeof CreateOAuthProviderInputSchema>;

/** Input for `PATCH /api/admin/oauth-providers/:id`. All fields optional
 *  except id is taken from the URL. */
export const UpdateOAuthProviderInputSchema = CreateOAuthProviderInputSchema.omit({ id: true }).partial();

export type UpdateOAuthProviderInput = z.infer<typeof UpdateOAuthProviderInputSchema>;

/** Built-in provider presets. UI exposes these as "Add GitHub" / "Add Google"
 *  buttons that pre-fill the admin form. Admin still supplies clientId +
 *  clientSecret for their own OAuth App. */
export const OAUTH_PROVIDER_PRESETS = {
  github: {
    id: 'github',
    name: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    revokeUrl: undefined,
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['repo', 'read:user'],
  },
  google: {
    id: 'google',
    name: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scopes: ['openid', 'email', 'profile'],
  },
} as const satisfies Record<string, Omit<CreateOAuthProviderInput, 'clientId' | 'clientSecret'>>;
