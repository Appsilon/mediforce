import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryConnectionRepository,
  InMemoryOAuthProviderRepository,
} from '@mediforce/platform-core';
import {
  resolveConnectionEnv,
  StepConnectionAliasCollisionError,
  StepConnectionMissingError,
} from '../resolve-connection-env.js';

const NS = 'acme';
const NOW = () => 1_000_000_000_000;

async function seedProvider(
  repo: InMemoryOAuthProviderRepository,
  overrides: { id?: string; envAlias?: string[] } = {},
): Promise<void> {
  await repo.create(NS, {
    id: overrides.id ?? 'github',
    name: 'GitHub',
    clientId: 'cid',
    clientSecret: 'csec',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['repo'],
    envAlias: overrides.envAlias,
  });
}

async function seedConnection(
  repo: InMemoryConnectionRepository,
  overrides: { id?: string; providerId?: string; accessToken?: string },
): Promise<void> {
  const id = overrides.id ?? 'github-mediforce';
  await repo.create(NS, {
    id,
    name: 'GitHub',
    auth: { type: 'oauth', providerId: overrides.providerId ?? 'github' },
  });
  await repo.setTokens(NS, id, { accessToken: overrides.accessToken ?? 'gho_fresh' });
}

describe('resolveConnectionEnv', () => {
  let connRepo: InMemoryConnectionRepository;
  let providerRepo: InMemoryOAuthProviderRepository;

  beforeEach(() => {
    connRepo = new InMemoryConnectionRepository();
    providerRepo = new InMemoryOAuthProviderRepository();
  });

  it('returns empty env when no connections requested', async () => {
    const result = await resolveConnectionEnv(NS, [], {
      connectionRepo: connRepo,
      oauthProviderRepo: providerRepo,
      fetchImpl: vi.fn() as unknown as typeof fetch,
      now: NOW,
    });
    expect(result).toEqual({ vars: {}, injectedKeys: [] });
  });

  it('emits CONN_<ID>_TOKEN per oauth connection', async () => {
    await seedProvider(providerRepo);
    await seedConnection(connRepo, { id: 'github-mediforce', accessToken: 'gho_one' });

    const result = await resolveConnectionEnv(NS, ['github-mediforce'], {
      connectionRepo: connRepo,
      oauthProviderRepo: providerRepo,
      now: NOW,
    });
    expect(result.vars).toEqual({ CONN_GITHUB_MEDIFORCE_TOKEN: 'gho_one' });
    expect(result.injectedKeys).toEqual(['CONN_GITHUB_MEDIFORCE_TOKEN']);
  });

  it('throws StepConnectionMissingError for unknown connection id', async () => {
    await expect(
      resolveConnectionEnv(NS, ['ghost'], {
        connectionRepo: connRepo,
        oauthProviderRepo: providerRepo,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(StepConnectionMissingError);
  });

  it('emits provider envAlias when unambiguous', async () => {
    await seedProvider(providerRepo, { envAlias: ['GITHUB_TOKEN', 'GH_TOKEN'] });
    await seedConnection(connRepo, { id: 'github-mediforce', accessToken: 'gho_alias' });

    const result = await resolveConnectionEnv(NS, ['github-mediforce'], {
      connectionRepo: connRepo,
      oauthProviderRepo: providerRepo,
      now: NOW,
    });
    expect(result.vars).toEqual({
      CONN_GITHUB_MEDIFORCE_TOKEN: 'gho_alias',
      GITHUB_TOKEN: 'gho_alias',
      GH_TOKEN: 'gho_alias',
    });
  });

  it('skips headers-typed connections at the env layer', async () => {
    await connRepo.create(NS, {
      id: 'static-jira',
      name: 'Jira',
      auth: { type: 'headers', headers: { 'X-Api-Key': '{{SECRET:k}}' } },
    });
    const result = await resolveConnectionEnv(NS, ['static-jira'], {
      connectionRepo: connRepo,
      oauthProviderRepo: providerRepo,
      now: NOW,
    });
    expect(result.vars).toEqual({});
  });

  it('throws StepConnectionAliasCollisionError when two connections share an envAlias', async () => {
    await seedProvider(providerRepo, { envAlias: ['GITHUB_TOKEN'] });
    await seedConnection(connRepo, { id: 'github-mediforce', accessToken: 'gho_a' });
    await seedConnection(connRepo, { id: 'github-personal', accessToken: 'gho_b' });

    const promise = resolveConnectionEnv(
      NS,
      ['github-mediforce', 'github-personal'],
      {
        connectionRepo: connRepo,
        oauthProviderRepo: providerRepo,
        now: NOW,
      },
    );
    await expect(promise).rejects.toBeInstanceOf(StepConnectionAliasCollisionError);
    await expect(promise).rejects.toThrow(/GITHUB_TOKEN/);
  });

  it('emits CONN_ tokens for both connections when their providers have no aliases', async () => {
    await seedProvider(providerRepo, { id: 'github' });
    await providerRepo.create(NS, {
      id: 'slack',
      name: 'Slack',
      clientId: 'sid',
      clientSecret: 'ssec',
      authorizeUrl: 'https://slack.com/oauth/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      userInfoUrl: 'https://slack.com/api/users.identity',
      scopes: ['chat:write'],
    });
    await seedConnection(connRepo, { id: 'gh', accessToken: 'gho_a' });
    await connRepo.create(NS, {
      id: 'slack-team',
      name: 'Slack',
      auth: { type: 'oauth', providerId: 'slack' },
    });
    await connRepo.setTokens(NS, 'slack-team', { accessToken: 'xoxb_y' });

    const result = await resolveConnectionEnv(NS, ['gh', 'slack-team'], {
      connectionRepo: connRepo,
      oauthProviderRepo: providerRepo,
      now: NOW,
    });
    expect(result.vars).toEqual({
      CONN_GH_TOKEN: 'gho_a',
      CONN_SLACK_TEAM_TOKEN: 'xoxb_y',
    });
  });

  it('refuses an expired oauth token (no auto-refresh in PR-1 stub)', async () => {
    const expiredAt = NOW() - 1;
    await seedProvider(providerRepo, { envAlias: ['GITHUB_TOKEN'] });
    await connRepo.create(NS, {
      id: 'github-mediforce',
      name: 'GitHub',
      auth: { type: 'oauth', providerId: 'github' },
    });
    await connRepo.setTokens(NS, 'github-mediforce', {
      accessToken: 'gho_old',
      refreshToken: 'ghr_xyz',
      expiresAt: expiredAt,
    });
    // Stub `getValidToken` does NOT exchange refresh tokens — the auto-
    // refresh PR adds the provider call + concurrency lock. For now an
    // expired token surfaces as a clear "Reconnect" error so the UI can
    // prompt the user.
    await expect(
      resolveConnectionEnv(NS, ['github-mediforce'], {
        connectionRepo: connRepo,
        oauthProviderRepo: providerRepo,
        now: NOW,
      }),
    ).rejects.toThrow(/expired/);
  });
});
