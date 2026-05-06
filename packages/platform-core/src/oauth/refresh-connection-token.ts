import type { ConnectionRepository } from '../interfaces/connection-repository.js';
import type { OAuthProviderRepository } from '../repositories/oauth-provider-repository.js';
import type { Connection, ConnectionOAuthAuth } from '../schemas/connection.js';
import type { OAuthProviderConfig } from '../schemas/oauth-provider.js';

/** How close to expiry (ms) we begin refreshing ahead-of-time. Mirrors the
 *  agent-runtime `REFRESH_MARGIN_MS` so concurrent consumers behave
 *  consistently. Wide enough to cover an agent spawn + retries without
 *  racing an expiry mid-request. */
export const CONNECTION_REFRESH_MARGIN_MS = 5 * 60_000;

/** Thrown when the refresh-token exchange is rejected by the provider
 *  (token revoked, user re-auth required, etc.). UI maps this to a
 *  "Reconnect" prompt. */
export class ConnectionRefreshRejectedError extends Error {
  public readonly providerId: string;
  public readonly status: number;
  constructor(providerId: string, status: number, detail?: string) {
    const suffix = detail ? ` — ${detail}` : '';
    super(`OAuth refresh rejected by provider "${providerId}" (HTTP ${status})${suffix}`);
    this.name = 'ConnectionRefreshRejectedError';
    this.providerId = providerId;
    this.status = status;
  }
}

/** Thrown when the connection has no usable token and no refresh path. */
export class ConnectionTokenUnavailableError extends Error {
  public readonly namespace: string;
  public readonly connectionId: string;
  constructor(namespace: string, connectionId: string, reason: string) {
    super(`Connection "${connectionId}" in "${namespace}" has no usable token: ${reason}`);
    this.name = 'ConnectionTokenUnavailableError';
    this.namespace = namespace;
    this.connectionId = connectionId;
  }
}

/** Thrown when the OAuth provider config referenced by a Connection is
 *  not present in the namespace. */
export class ConnectionProviderMissingError extends Error {
  public readonly namespace: string;
  public readonly connectionId: string;
  public readonly providerId: string;
  constructor(namespace: string, connectionId: string, providerId: string) {
    super(
      `Connection "${connectionId}" in "${namespace}" references unknown OAuth provider "${providerId}"`,
    );
    this.name = 'ConnectionProviderMissingError';
    this.namespace = namespace;
    this.connectionId = connectionId;
    this.providerId = providerId;
  }
}

export interface GetValidTokenDeps {
  connectionRepo: ConnectionRepository;
  oauthProviderRepo: Pick<OAuthProviderRepository, 'get'>;
  /** Injected `fetch` for testability. */
  fetchImpl?: typeof fetch;
  /** Injected clock for deterministic tests. */
  now?: () => number;
}

export interface ValidToken {
  /** The currently-valid access token. */
  accessToken: string;
  /** The Connection after any refresh (caller may inspect updated metadata). */
  connection: Connection;
  /** True when this call performed a refresh exchange against the provider. */
  refreshed: boolean;
}

interface ProviderTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
}

/** Resolve a usable access token for the named Connection.
 *
 *  Single source of truth for token freshness across the platform —
 *  HTTP MCP resolver, stdio MCP env injection, and script-step env
 *  injection should all funnel through this helper so they share one
 *  refresh path and one concurrency story.
 *
 *  Concurrency: the work runs inside `connectionRepo.runWithLock`, so
 *  concurrent callers serialize on the Connection document. The first
 *  caller in a refresh window does the exchange and persists the new
 *  token; later callers re-read inside the lock and short-circuit when
 *  the token they observe is already fresh.
 *
 *  Errors:
 *   - Connection missing → `ConnectionTokenUnavailableError`.
 *   - Connection not oauth-typed → `ConnectionTokenUnavailableError`.
 *   - Token expired and no refresh token → `ConnectionTokenUnavailableError`.
 *   - Provider rejects refresh → `ConnectionRefreshRejectedError`.
 *   - Provider missing → `ConnectionProviderMissingError`. */
export async function getValidToken(
  namespace: string,
  connectionId: string,
  deps: GetValidTokenDeps,
): Promise<ValidToken> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;

  // The lock callback returns either the unchanged Connection (no work
  // needed) or a refreshed Connection. Both repo impls auto-persist the
  // returned Connection inside the lock window — so the next caller in
  // line reads fresh state without racing the provider exchange.
  let refreshed = false;
  const finalConn = await deps.connectionRepo.runWithLock<Connection>(
    namespace,
    connectionId,
    async (currentInLock): Promise<Connection> => {
      if (currentInLock === null) {
        throw new ConnectionTokenUnavailableError(namespace, connectionId, 'connection missing');
      }
      if (currentInLock.auth.type !== 'oauth') {
        throw new ConnectionTokenUnavailableError(
          namespace,
          connectionId,
          'connection is not oauth-typed',
        );
      }

      const fresh = checkFreshness(currentInLock.auth, now());
      if (fresh.kind === 'fresh') {
        return currentInLock;
      }

      if (currentInLock.auth.refreshToken === undefined || currentInLock.auth.refreshToken === '') {
        throw new ConnectionTokenUnavailableError(
          namespace,
          connectionId,
          'access token expired and no refresh token available',
        );
      }

      const provider = await deps.oauthProviderRepo.get(namespace, currentInLock.auth.providerId);
      if (provider === null) {
        throw new ConnectionProviderMissingError(
          namespace,
          connectionId,
          currentInLock.auth.providerId,
        );
      }

      const exchange = await runRefreshExchange({
        provider,
        refreshToken: currentInLock.auth.refreshToken,
        fetchImpl,
        now,
      });

      refreshed = true;
      const updated: Connection = {
        ...currentInLock,
        auth: {
          ...currentInLock.auth,
          accessToken: exchange.accessToken,
          refreshToken: exchange.refreshToken ?? currentInLock.auth.refreshToken,
          expiresAt: exchange.expiresAt,
          scope: exchange.scope ?? currentInLock.auth.scope,
          connectedAt: now(),
        } satisfies ConnectionOAuthAuth,
      };
      return updated;
    },
  );

  if (finalConn.auth.type !== 'oauth' || finalConn.auth.accessToken === undefined) {
    // Defensive: the lock body guarantees these conditions, but TypeScript
    // can't see through the closure side-effect on `refreshed`.
    throw new ConnectionTokenUnavailableError(namespace, connectionId, 'token disappeared');
  }

  return {
    accessToken: finalConn.auth.accessToken,
    connection: finalConn,
    refreshed,
  };
}

type FreshnessResult =
  | { kind: 'fresh'; accessToken: string }
  | { kind: 'expired' }
  | { kind: 'no-token' };

function checkFreshness(auth: ConnectionOAuthAuth, currentTime: number): FreshnessResult {
  if (auth.accessToken === undefined || auth.accessToken === '') return { kind: 'no-token' };
  if (auth.expiresAt === undefined) return { kind: 'fresh', accessToken: auth.accessToken };
  if (auth.expiresAt - currentTime > CONNECTION_REFRESH_MARGIN_MS) {
    return { kind: 'fresh', accessToken: auth.accessToken };
  }
  return { kind: 'expired' };
}

async function runRefreshExchange(args: {
  provider: OAuthProviderConfig;
  refreshToken: string;
  fetchImpl: typeof fetch;
  now: () => number;
}): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number; scope?: string }> {
  const { provider, refreshToken, fetchImpl, now } = args;

  const bodyFields: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
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
    throw new ConnectionRefreshRejectedError(
      provider.id,
      0,
      err instanceof Error ? err.message : 'network error',
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new ConnectionRefreshRejectedError(provider.id, response.status, detail.slice(0, 200));
  }

  const parsed = (await response.json().catch(() => ({}))) as ProviderTokenResponse;
  if (typeof parsed.error === 'string') {
    throw new ConnectionRefreshRejectedError(
      provider.id,
      response.status,
      typeof parsed.error_description === 'string' ? parsed.error_description : parsed.error,
    );
  }

  if (typeof parsed.access_token !== 'string' || parsed.access_token === '') {
    throw new ConnectionRefreshRejectedError(
      provider.id,
      response.status,
      'provider response missing access_token',
    );
  }

  const accessToken = parsed.access_token;
  const newRefreshToken =
    typeof parsed.refresh_token === 'string' && parsed.refresh_token !== ''
      ? parsed.refresh_token
      : undefined;
  const expiresIn = typeof parsed.expires_in === 'number' && parsed.expires_in > 0
    ? parsed.expires_in
    : undefined;
  const expiresAt = expiresIn !== undefined ? now() + expiresIn * 1000 : undefined;
  const scope = typeof parsed.scope === 'string' ? parsed.scope : undefined;

  return { accessToken, refreshToken: newRefreshToken, expiresAt, scope };
}
