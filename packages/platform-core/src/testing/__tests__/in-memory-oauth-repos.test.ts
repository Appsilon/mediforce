import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryOAuthProviderRepository } from '../in-memory-oauth-provider-repository.js';
import { InMemoryAgentOAuthTokenRepository } from '../in-memory-agent-oauth-token-repository.js';
import { ProviderAlreadyExistsError } from '../../repositories/oauth-provider-repository.js';
import type { CreateOAuthProviderInput } from '../../schemas/oauth-provider.js';
import type { AgentOAuthToken } from '../../schemas/agent-oauth-token.js';

const providerInput: CreateOAuthProviderInput = {
  id: 'github',
  name: 'GitHub',
  clientId: 'Iv1.xxx',
  clientSecret: 'yyy',
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  userInfoUrl: 'https://api.github.com/user',
  scopes: ['repo'],
};

describe('InMemoryOAuthProviderRepository', () => {
  let repo: InMemoryOAuthProviderRepository;

  beforeEach(() => {
    repo = new InMemoryOAuthProviderRepository();
    repo.setClock(1_700_000_000_000);
  });

  it('returns empty list for unknown namespace', async () => {
    expect(await repo.list('unknown')).toEqual([]);
  });

  it('creates, reads, lists a provider', async () => {
    const created = await repo.create('acme', providerInput);
    expect(created.id).toBe('github');
    expect(created.createdAt).toBe(created.updatedAt);

    const list = await repo.list('acme');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('github');

    const fetched = await repo.get('acme', 'github');
    expect(fetched?.clientSecret).toBe('yyy');
  });

  it('returns null for missing provider', async () => {
    expect(await repo.get('acme', 'ghost')).toBeNull();
  });

  it('throws ProviderAlreadyExistsError on duplicate id within namespace', async () => {
    await repo.create('acme', providerInput);
    await expect(repo.create('acme', providerInput)).rejects.toBeInstanceOf(
      ProviderAlreadyExistsError,
    );
  });

  it('permits the same id across distinct namespaces', async () => {
    await repo.create('acme', providerInput);
    await expect(repo.create('globex', providerInput)).resolves.toBeDefined();
  });

  it('updates only supplied fields and advances updatedAt', async () => {
    const created = await repo.create('acme', providerInput);
    const originalUpdatedAt = created.updatedAt;

    const patched = await repo.update('acme', 'github', { name: 'Renamed' });
    expect(patched?.name).toBe('Renamed');
    expect(patched?.clientSecret).toBe('yyy');
    expect(patched && patched.updatedAt > originalUpdatedAt).toBe(true);
  });

  it('returns null when updating a missing provider', async () => {
    expect(await repo.update('acme', 'ghost', { name: 'x' })).toBeNull();
  });

  it('deletes and reports whether something was removed', async () => {
    await repo.create('acme', providerInput);
    expect(await repo.delete('acme', 'github')).toBe(true);
    expect(await repo.delete('acme', 'github')).toBe(false);
  });
});

const tokenFixture: AgentOAuthToken = {
  provider: 'github',
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: 1_700_000_000_000,
  scope: 'repo',
  providerUserId: '12345',
  accountLogin: '@octocat',
  connectedAt: 1_699_000_000_000,
  connectedBy: 'firebase-uid',
};

describe('InMemoryAgentOAuthTokenRepository', () => {
  let repo: InMemoryAgentOAuthTokenRepository;

  beforeEach(() => {
    repo = new InMemoryAgentOAuthTokenRepository();
  });

  it('returns null when no token exists', async () => {
    expect(await repo.get('acme', 'agent-1', 'github')).toBeNull();
  });

  it('stores and reads back a token (copy semantics)', async () => {
    await repo.put('acme', 'agent-1', 'github', tokenFixture);

    const fetched = await repo.get('acme', 'agent-1', 'github');
    expect(fetched).toEqual(tokenFixture);
    // Mutation of the fetched copy must not bleed back into the store.
    if (fetched) fetched.accessToken = 'mutated';
    const fetchedAgain = await repo.get('acme', 'agent-1', 'github');
    expect(fetchedAgain?.accessToken).toBe('access-1');
  });

  it('overwrites on subsequent put (refresh flow)', async () => {
    await repo.put('acme', 'agent-1', 'github', tokenFixture);
    await repo.put('acme', 'agent-1', 'github', { ...tokenFixture, accessToken: 'access-2' });

    const fetched = await repo.get('acme', 'agent-1', 'github');
    expect(fetched?.accessToken).toBe('access-2');
  });

  it('isolates tokens between (agent, server) pairs', async () => {
    await repo.put('acme', 'agent-1', 'github', tokenFixture);
    await repo.put('acme', 'agent-1', 'google', { ...tokenFixture, provider: 'google' });
    await repo.put('acme', 'agent-2', 'github', { ...tokenFixture, accessToken: 'different' });

    const list1 = await repo.listByAgent('acme', 'agent-1');
    expect(list1.map((t) => t.serverName).sort()).toEqual(['github', 'google']);

    const list2 = await repo.listByAgent('acme', 'agent-2');
    expect(list2).toHaveLength(1);
    expect(list2[0].accessToken).toBe('different');
  });

  it('deletes and reports the outcome', async () => {
    await repo.put('acme', 'agent-1', 'github', tokenFixture);
    expect(await repo.delete('acme', 'agent-1', 'github')).toBe(true);
    expect(await repo.delete('acme', 'agent-1', 'github')).toBe(false);
  });

  it('isolates namespaces', async () => {
    await repo.put('acme', 'agent-1', 'github', tokenFixture);
    expect(await repo.get('globex', 'agent-1', 'github')).toBeNull();
    expect(await repo.listByAgent('globex', 'agent-1')).toEqual([]);
  });
});
