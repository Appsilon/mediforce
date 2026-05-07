import { describe, it, expect, beforeEach } from 'vitest';
import {
  CONNECTION_REFRESH_MARGIN_MS,
  ConnectionTokenUnavailableError,
  getValidToken,
} from '../refresh-connection-token.js';
import { InMemoryConnectionRepository } from '../../testing/in-memory-connection-repository.js';

const NAMESPACE = 'acme';

async function seedConnection(
  repo: InMemoryConnectionRepository,
  overrides: { accessToken?: string; expiresAt?: number } = {},
): Promise<void> {
  await repo.create(NAMESPACE, {
    id: 'github-mediforce',
    name: 'GitHub',
    auth: { type: 'oauth', providerId: 'github' },
  });
  if (overrides.accessToken !== undefined) {
    await repo.setTokens(NAMESPACE, 'github-mediforce', {
      accessToken: overrides.accessToken,
      ...(overrides.expiresAt !== undefined ? { expiresAt: overrides.expiresAt } : {}),
    });
  }
}

describe('getValidToken (stub — PR-1)', () => {
  let conn: InMemoryConnectionRepository;

  beforeEach(() => {
    conn = new InMemoryConnectionRepository();
  });

  it('returns the access token when connected and not near expiry', async () => {
    const now = () => 1_000_000_000_000;
    await seedConnection(conn, {
      accessToken: 'gho_fresh',
      expiresAt: now() + CONNECTION_REFRESH_MARGIN_MS + 60_000,
    });
    const result = await getValidToken(NAMESPACE, 'github-mediforce', {
      connectionRepo: conn,
      now,
    });
    expect(result.accessToken).toBe('gho_fresh');
    expect(result.refreshed).toBe(false);
  });

  it('returns the access token when expiresAt is undefined (long-lived)', async () => {
    await seedConnection(conn, { accessToken: 'gho_longlived' });
    const result = await getValidToken(NAMESPACE, 'github-mediforce', {
      connectionRepo: conn,
    });
    expect(result.accessToken).toBe('gho_longlived');
    expect(result.refreshed).toBe(false);
  });

  it('throws ConnectionTokenUnavailableError when connection missing', async () => {
    await expect(
      getValidToken(NAMESPACE, 'never', { connectionRepo: conn }),
    ).rejects.toBeInstanceOf(ConnectionTokenUnavailableError);
  });

  it('throws ConnectionTokenUnavailableError when access token absent (not connected)', async () => {
    // Created without setTokens — auth.accessToken is undefined.
    await conn.create(NAMESPACE, {
      id: 'github-mediforce',
      name: 'GitHub',
      auth: { type: 'oauth', providerId: 'github' },
    });
    await expect(
      getValidToken(NAMESPACE, 'github-mediforce', { connectionRepo: conn }),
    ).rejects.toThrow(/not connected/);
  });

  it('throws when token is within refresh margin of expiry', async () => {
    const now = () => 1_000_000_000_000;
    await seedConnection(conn, {
      accessToken: 'gho_expiring',
      expiresAt: now() + 60_000, // 1 min — well within 5min margin
    });
    await expect(
      getValidToken(NAMESPACE, 'github-mediforce', {
        connectionRepo: conn,
        now,
      }),
    ).rejects.toThrow(/expired/);
  });

  it('throws for headers-typed connection', async () => {
    await conn.create(NAMESPACE, {
      id: 'static',
      name: 'Static',
      auth: { type: 'headers', headers: { Authorization: 'Bearer abc' } },
    });
    await expect(
      getValidToken(NAMESPACE, 'static', { connectionRepo: conn }),
    ).rejects.toThrow(/not oauth-typed/);
  });

  it('accepts (and ignores) optional oauthProviderRepo / fetchImpl deps for forward-compat', async () => {
    await seedConnection(conn, { accessToken: 'gho_x' });
    const result = await getValidToken(NAMESPACE, 'github-mediforce', {
      connectionRepo: conn,
      oauthProviderRepo: { get: async () => null },
      fetchImpl: async () => new Response('unused'),
    });
    expect(result.accessToken).toBe('gho_x');
  });
});
