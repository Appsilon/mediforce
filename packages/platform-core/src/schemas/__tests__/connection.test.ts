import { describe, it, expect } from 'vitest';
import {
  ConnectionSchema,
  ConnectionAuthSchema,
  ConnectionOAuthAuthSchema,
  ConnectionHeadersAuthSchema,
  ConnectionTokenUpdateSchema,
  CreateConnectionInputSchema,
  UpdateConnectionInputSchema,
  PublicConnectionSchema,
  connectionTokenEnvName,
} from '../connection.js';

const NOW = '2026-05-06T00:00:00.000Z';

describe('ConnectionAuthSchema', () => {
  describe('oauth variant', () => {
    it('parses minimal oauth auth (id + providerId, no token yet)', () => {
      const result = ConnectionAuthSchema.safeParse({
        type: 'oauth',
        providerId: 'github',
      });
      expect(result.success).toBe(true);
    });

    it('parses fully populated oauth auth', () => {
      const result = ConnectionOAuthAuthSchema.safeParse({
        type: 'oauth',
        providerId: 'github',
        accessToken: 'gho_abc',
        refreshToken: 'ghr_xyz',
        expiresAt: 1_900_000_000_000,
        scope: 'repo read:user',
        providerUserId: '12345',
        accountLogin: 'octocat',
        connectedAt: 1_800_000_000_000,
        connectedBy: 'user-uid-1',
      });
      expect(result.success).toBe(true);
    });

    it('rejects oauth auth without providerId', () => {
      expect(
        ConnectionOAuthAuthSchema.safeParse({ type: 'oauth' }).success,
      ).toBe(false);
    });

    it('rejects oauth auth with empty providerId', () => {
      expect(
        ConnectionOAuthAuthSchema.safeParse({ type: 'oauth', providerId: '' }).success,
      ).toBe(false);
    });

    it('rejects oauth auth with empty accessToken', () => {
      expect(
        ConnectionOAuthAuthSchema.safeParse({
          type: 'oauth',
          providerId: 'github',
          accessToken: '',
        }).success,
      ).toBe(false);
    });

    it('rejects oauth auth with non-positive expiresAt', () => {
      expect(
        ConnectionOAuthAuthSchema.safeParse({
          type: 'oauth',
          providerId: 'github',
          expiresAt: 0,
        }).success,
      ).toBe(false);
    });

    it('rejects oauth auth with rogue fields (strict)', () => {
      expect(
        ConnectionOAuthAuthSchema.safeParse({
          type: 'oauth',
          providerId: 'github',
          headers: { Authorization: 'Bearer x' },
        }).success,
      ).toBe(false);
    });
  });

  describe('headers variant', () => {
    it('parses single-header static auth', () => {
      const result = ConnectionHeadersAuthSchema.safeParse({
        type: 'headers',
        headers: { Authorization: 'Bearer {{SECRET:my_token}}' },
      });
      expect(result.success).toBe(true);
    });

    it('parses multi-header static auth', () => {
      const result = ConnectionHeadersAuthSchema.safeParse({
        type: 'headers',
        headers: {
          'X-Api-Key': '{{SECRET:foo_key}}',
          'User-Agent': 'mediforce',
        },
      });
      expect(result.success).toBe(true);
    });

    it('rejects headers with non-string values', () => {
      expect(
        ConnectionHeadersAuthSchema.safeParse({
          type: 'headers',
          headers: { 'X-Count': 42 },
        }).success,
      ).toBe(false);
    });

    it('accepts an empty header map (degenerate but legal)', () => {
      // The headers refactor explicitly subsumes "no auth" by absence of
      // connectionId on the catalog entry, so we don't disallow this here.
      expect(
        ConnectionHeadersAuthSchema.safeParse({ type: 'headers', headers: {} }).success,
      ).toBe(true);
    });
  });

  describe('discriminator', () => {
    it('rejects auth without type field', () => {
      expect(
        ConnectionAuthSchema.safeParse({ providerId: 'github' }).success,
      ).toBe(false);
    });

    it('rejects auth with unknown type', () => {
      expect(
        ConnectionAuthSchema.safeParse({ type: 'static', secretRef: 'x' }).success,
      ).toBe(false);
    });

    it('rejects type=none (subsumed by absence of connectionId)', () => {
      expect(
        ConnectionAuthSchema.safeParse({ type: 'none' }).success,
      ).toBe(false);
    });
  });
});

describe('ConnectionSchema', () => {
  const baseOauth = {
    id: 'github-mediforce',
    name: 'GitHub (Mediforce)',
    auth: { type: 'oauth' as const, providerId: 'github' },
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('parses a valid oauth connection', () => {
    const result = ConnectionSchema.safeParse(baseOauth);
    expect(result.success).toBe(true);
  });

  it('parses a connection with description', () => {
    const result = ConnectionSchema.safeParse({
      ...baseOauth,
      description: 'Mediforce-org GitHub for PR creation',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty id', () => {
    expect(ConnectionSchema.safeParse({ ...baseOauth, id: '' }).success).toBe(false);
  });

  it('rejects id with uppercase characters', () => {
    expect(
      ConnectionSchema.safeParse({ ...baseOauth, id: 'GitHubMediforce' }).success,
    ).toBe(false);
  });

  it('rejects id starting with a digit', () => {
    expect(
      ConnectionSchema.safeParse({ ...baseOauth, id: '1github' }).success,
    ).toBe(false);
  });

  it('rejects id with underscores (force hyphen-separated for env normalization)', () => {
    expect(
      ConnectionSchema.safeParse({ ...baseOauth, id: 'github_mediforce' }).success,
    ).toBe(false);
  });

  it('accepts hyphenated multi-word id', () => {
    expect(
      ConnectionSchema.safeParse({ ...baseOauth, id: 'github-mediforce-readonly' }).success,
    ).toBe(true);
  });

  it('rejects empty name', () => {
    expect(ConnectionSchema.safeParse({ ...baseOauth, name: '' }).success).toBe(false);
  });

  it('rejects rogue top-level fields (strict)', () => {
    expect(
      ConnectionSchema.safeParse({ ...baseOauth, foo: 'bar' }).success,
    ).toBe(false);
  });

  it('rejects missing createdAt', () => {
    const { createdAt: _omitted, ...input } = baseOauth;
    expect(ConnectionSchema.safeParse(input).success).toBe(false);
  });
});

describe('PublicConnectionSchema', () => {
  it('strips accessToken and refreshToken from oauth auth', () => {
    const parsed = PublicConnectionSchema.parse({
      id: 'github-mediforce',
      name: 'GitHub',
      auth: {
        type: 'oauth',
        providerId: 'github',
        accessToken: 'secret-access',
        refreshToken: 'secret-refresh',
        expiresAt: 1_900_000_000_000,
        accountLogin: 'octocat',
      },
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(parsed.auth.type).toBe('oauth');
    if (parsed.auth.type === 'oauth') {
      expect('accessToken' in parsed.auth).toBe(false);
      expect('refreshToken' in parsed.auth).toBe(false);
      expect(parsed.auth.expiresAt).toBe(1_900_000_000_000);
      expect(parsed.auth.accountLogin).toBe('octocat');
    }
  });

  it('passes through headers auth unchanged', () => {
    const parsed = PublicConnectionSchema.parse({
      id: 'static-api',
      name: 'Static API',
      auth: { type: 'headers', headers: { 'X-Api-Key': '{{SECRET:k}}' } },
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(parsed.auth.type).toBe('headers');
    if (parsed.auth.type === 'headers') {
      expect(parsed.auth.headers['X-Api-Key']).toBe('{{SECRET:k}}');
    }
  });
});

describe('CreateConnectionInputSchema / UpdateConnectionInputSchema', () => {
  it('CreateConnectionInputSchema omits server-managed timestamps', () => {
    const result = CreateConnectionInputSchema.safeParse({
      id: 'github-mediforce',
      name: 'GitHub',
      auth: { type: 'oauth', providerId: 'github' },
    });
    expect(result.success).toBe(true);
  });

  it('UpdateConnectionInputSchema accepts partial patches without id', () => {
    const result = UpdateConnectionInputSchema.safeParse({ name: 'Renamed' });
    expect(result.success).toBe(true);
  });

  it('UpdateConnectionInputSchema rejects id (taken from URL)', () => {
    const result = UpdateConnectionInputSchema.safeParse({ id: 'x', name: 'y' });
    expect(result.success).toBe(false);
  });

  it('CreateConnectionInputSchema rejects accessToken in auth (OAuth flow only writes tokens)', () => {
    const result = CreateConnectionInputSchema.safeParse({
      id: 'github-mediforce',
      name: 'GitHub',
      auth: { type: 'oauth', providerId: 'github', accessToken: 'attacker-planted-token' },
    });
    expect(result.success).toBe(false);
  });

  it('CreateConnectionInputSchema rejects refreshToken in auth', () => {
    const result = CreateConnectionInputSchema.safeParse({
      id: 'github-mediforce',
      name: 'GitHub',
      auth: { type: 'oauth', providerId: 'github', refreshToken: 'planted' },
    });
    expect(result.success).toBe(false);
  });

  it('CreateConnectionInputSchema rejects expiresAt / connectedBy / scope etc. in auth', () => {
    const fields = ['expiresAt', 'scope', 'providerUserId', 'accountLogin', 'connectedAt', 'connectedBy'] as const;
    for (const f of fields) {
      const result = CreateConnectionInputSchema.safeParse({
        id: 'gh',
        name: 'gh',
        auth: { type: 'oauth', providerId: 'github', [f]: f === 'expiresAt' || f === 'connectedAt' ? 1_900_000_000_000 : 'value' },
      });
      expect(result.success, `field ${f} should be rejected`).toBe(false);
    }
  });

  it('UpdateConnectionInputSchema rejects accessToken in auth patch', () => {
    const result = UpdateConnectionInputSchema.safeParse({
      auth: { type: 'oauth', providerId: 'github', accessToken: 'attacker' },
    });
    expect(result.success).toBe(false);
  });

  it('CreateConnectionInputSchema accepts headers auth verbatim (no token stripping needed)', () => {
    const result = CreateConnectionInputSchema.safeParse({
      id: 'static-jira',
      name: 'Jira',
      auth: { type: 'headers', headers: { 'X-Api-Key': '{{SECRET:k}}' } },
    });
    expect(result.success).toBe(true);
  });
});

describe('ConnectionTokenUpdateSchema', () => {
  it('parses a minimal token update (just access token)', () => {
    expect(
      ConnectionTokenUpdateSchema.safeParse({ accessToken: 'gho_abc' }).success,
    ).toBe(true);
  });

  it('parses a full token update from a callback', () => {
    const result = ConnectionTokenUpdateSchema.safeParse({
      accessToken: 'gho_abc',
      refreshToken: 'ghr_xyz',
      expiresAt: 1_900_000_000_000,
      scope: 'repo read:user',
      providerUserId: '12345',
      accountLogin: 'octocat',
      connectedBy: 'user-uid-1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty accessToken', () => {
    expect(
      ConnectionTokenUpdateSchema.safeParse({ accessToken: '' }).success,
    ).toBe(false);
  });
});

describe('connectionTokenEnvName', () => {
  it('uppercases and prefixes a single-word id', () => {
    expect(connectionTokenEnvName('github')).toBe('CONN_GITHUB_TOKEN');
  });

  it('replaces hyphens with underscores', () => {
    expect(connectionTokenEnvName('github-mediforce')).toBe('CONN_GITHUB_MEDIFORCE_TOKEN');
  });

  it('handles multi-hyphen ids', () => {
    expect(connectionTokenEnvName('github-mediforce-readonly')).toBe(
      'CONN_GITHUB_MEDIFORCE_READONLY_TOKEN',
    );
  });
});
