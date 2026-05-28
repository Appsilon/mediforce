import {
  PublicOAuthProviderConfigSchema,
  type OAuthProviderConfig,
  type PublicOAuthProviderConfig,
} from '@mediforce/platform-core';

/** Strip `clientSecret` from a provider record before it leaves the API
 *  surface. Destructure first to drop the secret (the strict public schema
 *  would reject the extra key), then re-parse through
 *  `PublicOAuthProviderConfigSchema` so the returned object is a verified
 *  subset — a regression that added a new secret-bearing field would fail
 *  parse in tests instead of silently leaking. */
export function toPublicProvider(provider: OAuthProviderConfig): PublicOAuthProviderConfig {
  const { clientSecret: _clientSecret, ...publicFields } = provider;
  return PublicOAuthProviderConfigSchema.parse(publicFields);
}
