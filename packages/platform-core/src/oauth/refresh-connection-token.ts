import type { ConnectionRepository } from '../interfaces/connection-repository.js';
import type { OAuthProviderRepository } from '../repositories/oauth-provider-repository.js';
import type { Connection } from '../schemas/connection.js';

/** How close to expiry (ms) we consider a token "stale" and refuse it.
 *  Mirrors the agent-runtime `REFRESH_MARGIN_MS` so the auto-refresh
 *  follow-up PR can swap this stub for a refreshing impl without changing
 *  the consumer-facing contract. */
export const CONNECTION_REFRESH_MARGIN_MS = 5 * 60_000;

/** Thrown when the connection has no usable token. UI maps this to a
 *  "Reconnect" prompt at `/admin/connections/[id]`. */
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

export interface GetValidTokenDeps {
  connectionRepo: ConnectionRepository;
  /** Accepted but unused in this stub — kept so the auto-refresh PR can
   *  swap the impl without touching every callsite. */
  oauthProviderRepo?: Pick<OAuthProviderRepository, 'get'>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface ValidToken {
  accessToken: string;
  connection: Connection;
  /** Always false in the stub — true only after the auto-refresh follow-up
   *  PR lands, when this helper actually exchanges the refresh token. */
  refreshed: boolean;
}

/** Resolve a usable access token for the named Connection.
 *
 *  Stub behavior: load Connection, validate it's oauth-typed and connected,
 *  return the access token. Throws `ConnectionTokenUnavailableError` when
 *  the token is missing OR within `CONNECTION_REFRESH_MARGIN_MS` of
 *  expiry — UI is expected to prompt the user to Reconnect.
 *
 *  Auto-refresh against the OAuth provider's `/token` endpoint (with a
 *  per-Connection lock so concurrent callers see one refresh per expiry
 *  window) lands in a follow-up PR. The signature accepts `oauthProviderRepo`
 *  / `fetchImpl` already so swapping the implementation is a no-op for
 *  callers. */
export async function getValidToken(
  namespace: string,
  connectionId: string,
  deps: GetValidTokenDeps,
): Promise<ValidToken> {
  const now = (deps.now ?? Date.now)();

  const connection = await deps.connectionRepo.getById(namespace, connectionId);
  if (connection === null) {
    throw new ConnectionTokenUnavailableError(namespace, connectionId, 'connection missing');
  }
  if (connection.auth.type !== 'oauth') {
    throw new ConnectionTokenUnavailableError(
      namespace,
      connectionId,
      'connection is not oauth-typed',
    );
  }
  if (connection.auth.accessToken === undefined || connection.auth.accessToken === '') {
    throw new ConnectionTokenUnavailableError(
      namespace,
      connectionId,
      `not connected — visit /admin/connections/${connectionId} and click Connect`,
    );
  }
  if (
    connection.auth.expiresAt !== undefined &&
    connection.auth.expiresAt - now <= CONNECTION_REFRESH_MARGIN_MS
  ) {
    throw new ConnectionTokenUnavailableError(
      namespace,
      connectionId,
      `access token expired — visit /admin/connections/${connectionId} and click Reconnect`,
    );
  }

  return { accessToken: connection.auth.accessToken, connection, refreshed: false };
}
