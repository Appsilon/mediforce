import { describe, expect, it } from 'vitest';
import { resolveOAuthProviderSeeds } from '../seed-oauth-providers.js';
import type { OAuthProviderSeedEntry } from '@mediforce/platform-core';

const githubEntry: OAuthProviderSeedEntry = {
  id: 'github',
  name: 'GitHub',
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  userInfoUrl: 'https://api.github.com/user',
  scopes: ['repo', 'read:user'],
  clientIdEnv: 'OAUTH_GITHUB_CLIENT_ID',
  clientSecretEnv: 'OAUTH_GITHUB_CLIENT_SECRET',
};

describe('resolveOAuthProviderSeeds', () => {
  it('resolves env vars into client credentials', () => {
    const result = resolveOAuthProviderSeeds(
      { appsilon: [githubEntry] },
      {
        OAUTH_GITHUB_CLIENT_ID: 'Iv1.abc123',
        OAUTH_GITHUB_CLIENT_SECRET: 'shh-secret',
      },
    );

    expect(result.skipped).toEqual([]);
    expect(result.resolved).toHaveLength(1);
    const [{ namespace, input }] = result.resolved;
    expect(namespace).toBe('appsilon');
    expect(input.id).toBe('github');
    expect(input.clientId).toBe('Iv1.abc123');
    expect(input.clientSecret).toBe('shh-secret');
    expect(input.scopes).toEqual(['repo', 'read:user']);
    expect(input.userInfoUrl).toBe('https://api.github.com/user');
  });

  it('skips entries when required env vars are missing', () => {
    const result = resolveOAuthProviderSeeds(
      { appsilon: [githubEntry] },
      {},
    );

    expect(result.resolved).toEqual([]);
    expect(result.skipped).toEqual([
      {
        namespace: 'appsilon',
        id: 'github',
        missing: ['OAUTH_GITHUB_CLIENT_ID', 'OAUTH_GITHUB_CLIENT_SECRET'],
      },
    ]);
  });

  it('skips entries when env vars are present but empty', () => {
    const result = resolveOAuthProviderSeeds(
      { appsilon: [githubEntry] },
      {
        OAUTH_GITHUB_CLIENT_ID: '',
        OAUTH_GITHUB_CLIENT_SECRET: '',
      },
    );

    expect(result.resolved).toEqual([]);
    expect(result.skipped[0].missing).toEqual([
      'OAUTH_GITHUB_CLIENT_ID',
      'OAUTH_GITHUB_CLIENT_SECRET',
    ]);
  });

  it('treats clientSecretEnv as optional (PKCE-only public clients)', () => {
    const publicClient: OAuthProviderSeedEntry = {
      id: 'pkce-only',
      name: 'PKCE Only',
      authorizeUrl: 'https://example.com/auth',
      tokenUrl: 'https://example.com/token',
      scopes: ['read'],
      clientIdEnv: 'OAUTH_PKCE_CLIENT_ID',
      tokenEndpointAuthMethod: 'none',
    };

    const result = resolveOAuthProviderSeeds(
      { appsilon: [publicClient] },
      { OAUTH_PKCE_CLIENT_ID: 'public-client' },
    );

    expect(result.skipped).toEqual([]);
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].input.clientId).toBe('public-client');
    expect(result.resolved[0].input.clientSecret).toBeUndefined();
    expect(result.resolved[0].input.tokenEndpointAuthMethod).toBe('none');
  });

  it('handles multiple namespaces and entries independently', () => {
    const acmeEntry: OAuthProviderSeedEntry = {
      ...githubEntry,
      clientIdEnv: 'OAUTH_GITHUB_ACME_CLIENT_ID',
      clientSecretEnv: 'OAUTH_GITHUB_ACME_CLIENT_SECRET',
    };
    const result = resolveOAuthProviderSeeds(
      { appsilon: [githubEntry], acme: [acmeEntry] },
      {
        OAUTH_GITHUB_CLIENT_ID: 'app-id',
        OAUTH_GITHUB_CLIENT_SECRET: 'app-secret',
        // acme env vars intentionally absent
      },
    );

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].namespace).toBe('appsilon');
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].namespace).toBe('acme');
  });
});
