import { NextResponse } from 'next/server';
import { verifyState, type OAuthStatePayload } from '@mediforce/agent-runtime';
import type { AgentOAuthToken, OAuthProviderConfig } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';

/** Platform-owned callback for the OAuth authorization-code flow. Provider
 *  redirects here after consent. No user session (external origin), so the
 *  signed state HMAC is the sole integrity signal.
 *
 *  Flow: verify state → exchange code → fetch user info → persist token →
 *  302 back to the agent editor with `?connected=<serverName>`. Errors
 *  redirect to the same page with `?oauthError=<code>` so the UI can
 *  display a toast. */

interface TokenExchangeResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
}

interface ProviderUserInfo {
  providerUserId: string;
  accountLogin: string;
}

function buildSelfCallbackUrl(request: Request, providerSlug: string): string {
  const origin = new URL(request.url).origin;
  return `${origin}/api/oauth/${encodeURIComponent(providerSlug)}/callback`;
}

function redirectSuccess(request: Request, state: OAuthStatePayload): NextResponse {
  const origin = new URL(request.url).origin;
  const destination = `${origin}/${encodeURIComponent(state.namespace)}/agents/definitions/${encodeURIComponent(state.agentId)}?connected=${encodeURIComponent(state.serverName)}`;
  return NextResponse.redirect(destination, 302);
}

function redirectError(
  request: Request,
  reason: string,
  state: OAuthStatePayload | null,
): NextResponse {
  const origin = new URL(request.url).origin;
  const destination =
    state !== null
      ? `${origin}/${encodeURIComponent(state.namespace)}/agents/definitions/${encodeURIComponent(state.agentId)}?oauthError=${encodeURIComponent(reason)}`
      : `${origin}/?oauthError=${encodeURIComponent(reason)}`;
  return NextResponse.redirect(destination, 302);
}

async function exchangeCode(params: {
  provider: OAuthProviderConfig;
  code: string;
  redirectUri: string;
}): Promise<TokenExchangeResponse | null> {
  const { provider, code, redirectUri } = params;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    redirect_uri: redirectUri,
  });
  try {
    const response = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });
    if (!response.ok) return null;
    return (await response.json().catch(() => null)) as TokenExchangeResponse | null;
  } catch {
    return null;
  }
}

async function fetchUserInfo(
  provider: OAuthProviderConfig,
  accessToken: string,
): Promise<ProviderUserInfo | null> {
  try {
    const response = await fetch(provider.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    if (!response.ok) return null;
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (payload === null) return null;
    return extractUserInfo(payload);
  } catch {
    return null;
  }
}

/** Provider-agnostic extraction of stable id + display login. Matches the
 *  shape GitHub (`{id, login}`) and Google (`{sub, email}`) return, plus a
 *  generic fallback for custom providers using OpenID-style fields. */
function extractUserInfo(payload: Record<string, unknown>): ProviderUserInfo | null {
  const rawId =
    payload.id ??
    payload.sub ??
    payload.user_id ??
    payload.uid;
  const rawLogin =
    payload.login ??
    payload.email ??
    payload.preferred_username ??
    payload.name ??
    payload.username;

  if (rawId === undefined || rawId === null) return null;
  if (typeof rawLogin !== 'string' || rawLogin === '') return null;

  const providerUserId = typeof rawId === 'string' ? rawId : String(rawId);
  return { providerUserId, accountLogin: rawLogin };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider: providerSlug } = await params;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');

  if (code === null || code === '' || stateParam === null || stateParam === '') {
    return redirectError(request, 'missing-code-or-state', null);
  }

  const platformSecret = process.env.PLATFORM_API_KEY ?? '';
  if (platformSecret === '') {
    return redirectError(request, 'server-misconfigured', null);
  }

  const state = await verifyState(stateParam, platformSecret, 10 * 60_000);
  if (state === null) {
    return redirectError(request, 'invalid-state', null);
  }
  if (state.providerId !== providerSlug) {
    return redirectError(request, 'provider-mismatch', state);
  }

  const services = getPlatformServices();

  const provider = await services.oauthProviderRepo.get(state.namespace, state.providerId);
  if (provider === null) {
    return redirectError(request, 'provider-gone', state);
  }

  const exchange = await exchangeCode({
    provider,
    code,
    redirectUri: buildSelfCallbackUrl(request, providerSlug),
  });
  if (exchange === null) {
    return redirectError(request, 'code-exchange-failed', state);
  }
  if (typeof exchange.error === 'string') {
    return redirectError(request, 'code-exchange-rejected', state);
  }
  if (typeof exchange.access_token !== 'string' || exchange.access_token === '') {
    return redirectError(request, 'code-exchange-missing-token', state);
  }

  const accessToken = exchange.access_token;
  const refreshToken =
    typeof exchange.refresh_token === 'string' && exchange.refresh_token !== ''
      ? exchange.refresh_token
      : undefined;
  const expiresAt =
    typeof exchange.expires_in === 'number' && exchange.expires_in > 0
      ? Date.now() + exchange.expires_in * 1000
      : undefined;
  const scope = typeof exchange.scope === 'string' ? exchange.scope : provider.scopes.join(' ');

  const userInfo = await fetchUserInfo(provider, accessToken);
  if (userInfo === null) {
    return redirectError(request, 'userinfo-fetch-failed', state);
  }

  const token: AgentOAuthToken = {
    provider: state.providerId,
    accessToken,
    ...(refreshToken !== undefined ? { refreshToken } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    scope,
    providerUserId: userInfo.providerUserId,
    accountLogin: userInfo.accountLogin,
    connectedAt: Date.now(),
    connectedBy: state.connectedBy,
  };

  await services.agentOAuthTokenRepo.put(
    state.namespace,
    state.agentId,
    state.serverName,
    token,
  );

  return redirectSuccess(request, state);
}
