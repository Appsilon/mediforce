import { describe, it, expect, vi } from 'vitest';
import type { AgentOAuthToken, OAuthProviderConfig } from '@mediforce/platform-core';
import {
  REFRESH_MARGIN_MS,
  RefreshTokenRejectedError,
  RefreshTokenUnavailableError,
  renderOAuthHeader,
  resolveOAuthToken,
} from '../resolve-oauth-token.js';

const NOW = 1_700_000_000_000;

const provider: OAuthProviderConfig = {
  id: 'github',
  name: 'GitHub',
  clientId: 'client-xyz',
  clientSecret: 'secret-zzz',
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  userInfoUrl: 'https://api.github.com/user',
  scopes: ['repo'],
  createdAt: '2026-04-23T00:00:00.000Z',
  updatedAt: '2026-04-23T00:00:00.000Z',
};

function token(overrides: Partial<AgentOAuthToken> = {}): AgentOAuthToken {
  return {
    provider: 'github',
    accessToken: 'original',
    refreshToken: 'refresh-1',
    expiresAt: NOW + 30 * 60_000,
    scope: 'repo',
    providerUserId: '1',
    accountLogin: '@octocat',
    connectedAt: NOW - 60_000,
    connectedBy: 'firebase-uid',
    ...overrides,
  };
}

function mockFetch(response: Partial<Response> & { jsonBody?: unknown; textBody?: string }): typeof fetch {
  const ok = response.ok ?? true;
  const status = response.status ?? (ok ? 200 : 500);
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => response.jsonBody ?? {},
    text: async () => response.textBody ?? '',
  } as unknown as Response));
}

describe('resolveOAuthToken', () => {
  it('returns the token unchanged when expiry is far away', async () => {
    const fetchImpl = mockFetch({ ok: true, jsonBody: { access_token: 'new' } });
    const result = await resolveOAuthToken({
      token: token({ expiresAt: NOW + 30 * 60_000 }),
      provider,
      fetchImpl,
      now: () => NOW,
    });
    expect(result.wasRefreshed).toBe(false);
    expect(result.token.accessToken).toBe('original');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns the token unchanged when no expiresAt is recorded (long-lived)', async () => {
    const fetchImpl = mockFetch({ ok: true, jsonBody: {} });
    const result = await resolveOAuthToken({
      token: token({ expiresAt: undefined }),
      provider,
      fetchImpl,
      now: () => NOW,
    });
    expect(result.wasRefreshed).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refreshes when within the margin and the provider returns fresh tokens', async () => {
    const fetchImpl = mockFetch({
      ok: true,
      jsonBody: {
        access_token: 'fresh-access',
        refresh_token: 'fresh-refresh',
        expires_in: 3600,
        scope: 'repo read:user',
      },
    });

    const result = await resolveOAuthToken({
      token: token({ expiresAt: NOW + 30_000 }),
      provider,
      fetchImpl,
      now: () => NOW,
    });

    expect(result.wasRefreshed).toBe(true);
    expect(result.token.accessToken).toBe('fresh-access');
    expect(result.token.refreshToken).toBe('fresh-refresh');
    expect(result.token.expiresAt).toBe(NOW + 3600 * 1000);
    expect(result.token.scope).toBe('repo read:user');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refreshes right at the margin boundary (<= is inclusive)', async () => {
    const fetchImpl = mockFetch({
      ok: true,
      jsonBody: { access_token: 'fresh' },
    });
    const result = await resolveOAuthToken({
      token: token({ expiresAt: NOW + REFRESH_MARGIN_MS }),
      provider,
      fetchImpl,
      now: () => NOW,
    });
    expect(result.wasRefreshed).toBe(true);
  });

  it('preserves the old refresh token when provider rotates without issuing a new one', async () => {
    const fetchImpl = mockFetch({
      ok: true,
      jsonBody: { access_token: 'fresh', expires_in: 3600 },
    });
    const result = await resolveOAuthToken({
      token: token({ expiresAt: NOW, refreshToken: 'refresh-keep' }),
      provider,
      fetchImpl,
      now: () => NOW,
    });
    expect(result.token.refreshToken).toBe('refresh-keep');
  });

  it('throws RefreshTokenUnavailableError when expiry is close but no refresh token exists', async () => {
    await expect(
      resolveOAuthToken({
        token: token({ expiresAt: NOW + 10_000, refreshToken: undefined }),
        provider,
        now: () => NOW,
      }),
    ).rejects.toBeInstanceOf(RefreshTokenUnavailableError);
  });

  it('throws RefreshTokenRejectedError when the provider returns a non-2xx response', async () => {
    const fetchImpl = mockFetch({ ok: false, status: 400, textBody: 'bad_request: invalid_grant' });
    await expect(
      resolveOAuthToken({
        token: token({ expiresAt: NOW + 10_000 }),
        provider,
        fetchImpl,
        now: () => NOW,
      }),
    ).rejects.toBeInstanceOf(RefreshTokenRejectedError);
  });

  it('throws RefreshTokenRejectedError when the provider responds 200 with error body', async () => {
    const fetchImpl = mockFetch({
      ok: true,
      jsonBody: { error: 'invalid_grant', error_description: 'token revoked' },
    });
    try {
      await resolveOAuthToken({
        token: token({ expiresAt: NOW + 10_000 }),
        provider,
        fetchImpl,
        now: () => NOW,
      });
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RefreshTokenRejectedError);
      if (err instanceof RefreshTokenRejectedError) {
        expect(err.message).toContain('token revoked');
      }
    }
  });

  it('throws RefreshTokenRejectedError when provider response lacks access_token', async () => {
    const fetchImpl = mockFetch({ ok: true, jsonBody: { refresh_token: 'only-refresh' } });
    await expect(
      resolveOAuthToken({
        token: token({ expiresAt: NOW + 10_000 }),
        provider,
        fetchImpl,
        now: () => NOW,
      }),
    ).rejects.toBeInstanceOf(RefreshTokenRejectedError);
  });

  it('catches network errors and wraps them as RefreshTokenRejectedError', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    try {
      await resolveOAuthToken({
        token: token({ expiresAt: NOW + 10_000 }),
        provider,
        fetchImpl,
        now: () => NOW,
      });
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RefreshTokenRejectedError);
      if (err instanceof RefreshTokenRejectedError) {
        expect(err.status).toBe(0);
        expect(err.message).toContain('ECONNREFUSED');
      }
    }
  });
});

describe('renderOAuthHeader', () => {
  it('substitutes {token} once', () => {
    expect(renderOAuthHeader('Bearer {token}', 'abc123')).toBe('Bearer abc123');
  });

  it('substitutes {token} multiple times', () => {
    expect(renderOAuthHeader('{token}-{token}', 'xyz')).toBe('xyz-xyz');
  });

  it('returns the template unchanged when no placeholder is present', () => {
    expect(renderOAuthHeader('static-value', 'abc')).toBe('static-value');
  });
});
