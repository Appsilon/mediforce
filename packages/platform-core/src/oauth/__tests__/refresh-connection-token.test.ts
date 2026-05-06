import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CONNECTION_REFRESH_MARGIN_MS,
  ConnectionProviderMissingError,
  ConnectionRefreshRejectedError,
  ConnectionTokenUnavailableError,
  getValidToken,
} from '../refresh-connection-token.js';
import { InMemoryConnectionRepository } from '../../testing/in-memory-connection-repository.js';
import { InMemoryOAuthProviderRepository } from '../../testing/in-memory-oauth-provider-repository.js';
import type { CreateOAuthProviderInput } from '../../schemas/oauth-provider.js';

const NAMESPACE = 'acme';

const providerInput: CreateOAuthProviderInput = {
  id: 'github',
  name: 'GitHub',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  userInfoUrl: 'https://api.github.com/user',
  scopes: ['repo'],
};

async function seedConnection(
  repos: { conn: InMemoryConnectionRepository; provider: InMemoryOAuthProviderRepository },
  overrides: { accessToken?: string; refreshToken?: string; expiresAt?: number } = {},
): Promise<void> {
  await repos.provider.create(NAMESPACE, providerInput);
  await repos.conn.create(NAMESPACE, {
    id: 'github-mediforce',
    name: 'GitHub (Mediforce)',
    auth: { type: 'oauth', providerId: 'github' },
  });
  await repos.conn.setTokens(NAMESPACE, 'github-mediforce', {
    accessToken: overrides.accessToken ?? 'gho_old',
    refreshToken: overrides.refreshToken ?? 'ghr_old',
    ...(overrides.expiresAt !== undefined ? { expiresAt: overrides.expiresAt } : {}),
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('getValidToken — fresh path', () => {
  let conn: InMemoryConnectionRepository;
  let provider: InMemoryOAuthProviderRepository;

  beforeEach(() => {
    conn = new InMemoryConnectionRepository();
    provider = new InMemoryOAuthProviderRepository();
  });

  it('returns the existing token when expiresAt is comfortably in the future', async () => {
    const now = () => 1_000_000_000_000;
    await seedConnection(
      { conn, provider },
      { accessToken: 'gho_fresh', expiresAt: now() + CONNECTION_REFRESH_MARGIN_MS + 60_000 },
    );
    const fetchImpl = vi.fn();
    const result = await getValidToken(NAMESPACE, 'github-mediforce', {
      connectionRepo: conn,
      oauthProviderRepo: provider,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now,
    });
    expect(result.refreshed).toBe(false);
    expect(result.accessToken).toBe('gho_fresh');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns the existing token when expiresAt is undefined (long-lived)', async () => {
    await seedConnection({ conn, provider }, { accessToken: 'gho_longlived' });
    const fetchImpl = vi.fn();
    const result = await getValidToken(NAMESPACE, 'github-mediforce', {
      connectionRepo: conn,
      oauthProviderRepo: provider,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.refreshed).toBe(false);
    expect(result.accessToken).toBe('gho_longlived');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('getValidToken — refresh path', () => {
  let conn: InMemoryConnectionRepository;
  let provider: InMemoryOAuthProviderRepository;

  beforeEach(() => {
    conn = new InMemoryConnectionRepository();
    provider = new InMemoryOAuthProviderRepository();
  });

  it('exchanges the refresh token and persists the new access token', async () => {
    const now = () => 1_000_000_000_000;
    await seedConnection(
      { conn, provider },
      { accessToken: 'gho_old', refreshToken: 'ghr_xyz', expiresAt: now() - 1 },
    );

    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        access_token: 'gho_NEW',
        refresh_token: 'ghr_NEW',
        expires_in: 3600,
        scope: 'repo read:user',
      }),
    );

    const result = await getValidToken(NAMESPACE, 'github-mediforce', {
      connectionRepo: conn,
      oauthProviderRepo: provider,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now,
    });

    expect(result.refreshed).toBe(true);
    expect(result.accessToken).toBe('gho_NEW');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const persisted = await conn.getById(NAMESPACE, 'github-mediforce');
    expect(persisted).not.toBeNull();
    if (persisted?.auth.type === 'oauth') {
      expect(persisted.auth.accessToken).toBe('gho_NEW');
      expect(persisted.auth.refreshToken).toBe('ghr_NEW');
      expect(persisted.auth.expiresAt).toBe(now() + 3600 * 1000);
      expect(persisted.auth.scope).toBe('repo read:user');
    }
  });

  it('keeps the existing refresh token when the provider does not return a new one', async () => {
    const now = () => 1_000_000_000_000;
    await seedConnection(
      { conn, provider },
      { accessToken: 'gho_old', refreshToken: 'ghr_keep', expiresAt: now() - 1 },
    );
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({ access_token: 'gho_only', expires_in: 60 }),
    );

    const result = await getValidToken(NAMESPACE, 'github-mediforce', {
      connectionRepo: conn,
      oauthProviderRepo: provider,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now,
    });
    expect(result.refreshed).toBe(true);

    const persisted = await conn.getById(NAMESPACE, 'github-mediforce');
    if (persisted?.auth.type === 'oauth') {
      expect(persisted.auth.refreshToken).toBe('ghr_keep');
    }
  });

  it('throws ConnectionRefreshRejectedError on non-2xx response', async () => {
    const now = () => 1_000_000_000_000;
    await seedConnection(
      { conn, provider },
      { accessToken: 'old', refreshToken: 'r', expiresAt: now() - 1 },
    );
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      new Response('bad refresh', { status: 401 }),
    );
    await expect(
      getValidToken(NAMESPACE, 'github-mediforce', {
        connectionRepo: conn,
        oauthProviderRepo: provider,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        now,
      }),
    ).rejects.toBeInstanceOf(ConnectionRefreshRejectedError);
  });

  it('throws ConnectionRefreshRejectedError on { error: ... } response body', async () => {
    const now = () => 1_000_000_000_000;
    await seedConnection(
      { conn, provider },
      { accessToken: 'old', refreshToken: 'r', expiresAt: now() - 1 },
    );
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({ error: 'invalid_grant', error_description: 'bad refresh' }),
    );
    await expect(
      getValidToken(NAMESPACE, 'github-mediforce', {
        connectionRepo: conn,
        oauthProviderRepo: provider,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        now,
      }),
    ).rejects.toBeInstanceOf(ConnectionRefreshRejectedError);
  });

  it('throws ConnectionTokenUnavailableError when expired and no refresh token', async () => {
    const now = () => 1_000_000_000_000;
    await provider.create(NAMESPACE, providerInput);
    await conn.create(NAMESPACE, {
      id: 'github-mediforce',
      name: 'GitHub',
      auth: { type: 'oauth', providerId: 'github' },
    });
    await conn.setTokens(NAMESPACE, 'github-mediforce', {
      accessToken: 'expired',
      expiresAt: now() - 1,
    });
    await expect(
      getValidToken(NAMESPACE, 'github-mediforce', {
        connectionRepo: conn,
        oauthProviderRepo: provider,
        now,
      }),
    ).rejects.toBeInstanceOf(ConnectionTokenUnavailableError);
  });

  it('throws ConnectionProviderMissingError when the OAuth provider was deleted', async () => {
    const now = () => 1_000_000_000_000;
    await provider.create(NAMESPACE, providerInput);
    await conn.create(NAMESPACE, {
      id: 'github-mediforce',
      name: 'GitHub',
      auth: { type: 'oauth', providerId: 'github' },
    });
    await conn.setTokens(NAMESPACE, 'github-mediforce', {
      accessToken: 'old',
      refreshToken: 'r',
      expiresAt: now() - 1,
    });
    await provider.delete(NAMESPACE, 'github');

    await expect(
      getValidToken(NAMESPACE, 'github-mediforce', {
        connectionRepo: conn,
        oauthProviderRepo: provider,
        now,
      }),
    ).rejects.toBeInstanceOf(ConnectionProviderMissingError);
  });

  it('throws ConnectionTokenUnavailableError for missing connection', async () => {
    await expect(
      getValidToken(NAMESPACE, 'never', {
        connectionRepo: conn,
        oauthProviderRepo: provider,
      }),
    ).rejects.toBeInstanceOf(ConnectionTokenUnavailableError);
  });

  it('throws ConnectionTokenUnavailableError for headers-typed connection', async () => {
    await conn.create(NAMESPACE, {
      id: 'static',
      name: 'Static',
      auth: { type: 'headers', headers: { Authorization: 'Bearer abc' } },
    });
    await expect(
      getValidToken(NAMESPACE, 'static', {
        connectionRepo: conn,
        oauthProviderRepo: provider,
      }),
    ).rejects.toBeInstanceOf(ConnectionTokenUnavailableError);
  });
});

describe('getValidToken — concurrency', () => {
  let conn: InMemoryConnectionRepository;
  let provider: InMemoryOAuthProviderRepository;

  beforeEach(() => {
    conn = new InMemoryConnectionRepository();
    provider = new InMemoryOAuthProviderRepository();
  });

  it('exchanges only once when N callers race against an expired token', async () => {
    const now = () => 1_000_000_000_000;
    await seedConnection(
      { conn, provider },
      { accessToken: 'old', refreshToken: 'r', expiresAt: now() - 1 },
    );

    let exchanges = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => {
      exchanges += 1;
      return jsonResponse({
        access_token: `gho_NEW_${exchanges}`,
        refresh_token: 'ghr_keep',
        expires_in: 3600,
      });
    });

    const callers = Array.from({ length: 10 }, () =>
      getValidToken(NAMESPACE, 'github-mediforce', {
        connectionRepo: conn,
        oauthProviderRepo: provider,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        now,
      }),
    );

    const results = await Promise.all(callers);

    expect(exchanges).toBe(1);
    // Exactly one caller saw the refresh; the rest read the persisted
    // post-refresh token without calling the provider.
    expect(results.filter((r) => r.refreshed)).toHaveLength(1);
    const tokens = new Set(results.map((r) => r.accessToken));
    expect(tokens.size).toBe(1);
    expect(tokens.has('gho_NEW_1')).toBe(true);
  });
});
