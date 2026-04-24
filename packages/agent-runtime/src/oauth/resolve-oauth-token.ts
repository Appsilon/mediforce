import type { AgentOAuthToken, OAuthProviderConfig } from '@mediforce/platform-core';

/** How close to expiry (ms) we start refreshing ahead-of-time. Chosen to
 *  cover the common case of a ~1min agent spawn + a few retries without
 *  racing an expiry mid-request. */
export const REFRESH_MARGIN_MS = 5 * 60_000;

export interface ResolveTokenOptions {
  token: AgentOAuthToken;
  provider: OAuthProviderConfig;
  /** Injected so tests can stub provider endpoints without hitting the
   *  network. Signature matches global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Clock injection for determinism. */
  now?: () => number;
}

export interface ResolvedToken {
  /** Fresh or passthrough token — always the currently-valid access token. */
  token: AgentOAuthToken;
  /** True when `resolveOAuthToken` performed a refresh exchange. Callers
   *  use this to know whether to persist the updated token back to the
   *  repository. */
  wasRefreshed: boolean;
}

/** Thrown when refresh is required but the provider's response indicates
 *  the refresh token is no longer valid (user revoked, rotated, etc.).
 *  UI maps this to a "Reconnect" prompt. */
export class RefreshTokenRejectedError extends Error {
  public readonly provider: string;
  public readonly status: number;

  constructor(provider: string, status: number, detail?: string) {
    const suffix = detail ? ` — ${detail}` : '';
    super(`OAuth refresh rejected by provider "${provider}" (HTTP ${status})${suffix}`);
    this.name = 'RefreshTokenRejectedError';
    this.provider = provider;
    this.status = status;
  }
}

/** Thrown when a token is near/past expiry but no refresh token exists.
 *  UI maps this to a "Reconnect" prompt. */
export class RefreshTokenUnavailableError extends Error {
  public readonly provider: string;

  constructor(provider: string) {
    super(
      `OAuth access token for provider "${provider}" is expired or expiring soon, ` +
      `and no refresh token is available. User must reconnect via the UI.`,
    );
    this.name = 'RefreshTokenUnavailableError';
    this.provider = provider;
  }
}

interface ProviderTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  token_type?: unknown;
  error?: unknown;
  error_description?: unknown;
}

/** Resolve a token for imminent use. If the access token has enough time
 *  left, returns it unchanged. Otherwise exchanges the refresh token with
 *  the provider and returns the new token (caller persists). */
export async function resolveOAuthToken(
  options: ResolveTokenOptions,
): Promise<ResolvedToken> {
  const { token, provider } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;

  // No expiry recorded → treat as long-lived (GitHub OAuth Apps default).
  if (token.expiresAt === undefined) {
    return { token, wasRefreshed: false };
  }

  const currentTime = now();
  const msLeft = token.expiresAt - currentTime;
  if (msLeft > REFRESH_MARGIN_MS) {
    return { token, wasRefreshed: false };
  }

  if (token.refreshToken === undefined || token.refreshToken === '') {
    throw new RefreshTokenUnavailableError(provider.id);
  }

  const bodyFields: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: token.refreshToken,
    client_id: provider.clientId,
  };
  if (provider.clientSecret !== undefined) {
    bodyFields.client_secret = provider.clientSecret;
  }
  const body = new URLSearchParams(bodyFields);

  let response: Response;
  try {
    response = await fetchImpl(provider.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });
  } catch (err) {
    throw new RefreshTokenRejectedError(
      provider.id,
      0,
      err instanceof Error ? err.message : 'network error',
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new RefreshTokenRejectedError(provider.id, response.status, detail.slice(0, 200));
  }

  const parsed = (await response.json().catch(() => ({}))) as ProviderTokenResponse;
  if (typeof parsed.error === 'string') {
    throw new RefreshTokenRejectedError(
      provider.id,
      response.status,
      typeof parsed.error_description === 'string'
        ? parsed.error_description
        : parsed.error,
    );
  }

  if (typeof parsed.access_token !== 'string' || parsed.access_token === '') {
    throw new RefreshTokenRejectedError(
      provider.id,
      response.status,
      'provider response missing access_token',
    );
  }

  const newAccessToken = parsed.access_token;
  const newRefreshToken =
    typeof parsed.refresh_token === 'string' && parsed.refresh_token !== ''
      ? parsed.refresh_token
      : token.refreshToken;
  const expiresIn =
    typeof parsed.expires_in === 'number' && parsed.expires_in > 0
      ? parsed.expires_in
      : undefined;
  const newExpiresAt = expiresIn !== undefined ? currentTime + expiresIn * 1000 : undefined;
  const newScope = typeof parsed.scope === 'string' ? parsed.scope : token.scope;

  return {
    token: {
      ...token,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresAt: newExpiresAt,
      scope: newScope,
    },
    wasRefreshed: true,
  };
}

/** Convenience: apply `headerValueTemplate.replace('{token}', accessToken)`
 *  with safe fallbacks. Exported here so the runtime writer and tests
 *  share a single substitution point. */
export function renderOAuthHeader(
  headerValueTemplate: string,
  accessToken: string,
): string {
  return headerValueTemplate.split('{token}').join(accessToken);
}
