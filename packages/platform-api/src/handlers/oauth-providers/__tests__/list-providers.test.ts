import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryOAuthProviderRepository } from '@mediforce/platform-core/testing';
import { listOAuthProviders } from '../list-providers.js';
import { ForbiddenError } from '../../../errors.js';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope.js';
import { adminRoles, memberRoles, sampleProviderInput } from './fixtures.js';

describe('listOAuthProviders handler', () => {
  let repo: InMemoryOAuthProviderRepository;

  beforeEach(async () => {
    repo = new InMemoryOAuthProviderRepository();
    await repo.create('alpha', sampleProviderInput);
  });

  it('returns providers for an api-key caller', async () => {
    const scope = createTestScope({ oauthProviderRepo: repo });

    const result = await listOAuthProviders({ namespace: 'alpha' }, scope);

    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].id).toBe('github');
  });

  it('strips clientSecret in output', async () => {
    const scope = createTestScope({ oauthProviderRepo: repo });

    const result = await listOAuthProviders({ namespace: 'alpha' }, scope);

    expect(result.providers[0]).not.toHaveProperty('clientSecret');
    expect(JSON.stringify(result)).not.toContain('client-secret-xyz');
  });

  it('returns providers for an admin user caller', async () => {
    const scope = createTestScope({
      oauthProviderRepo: repo,
      caller: userCaller('u-admin', ['alpha'], adminRoles),
    });

    const result = await listOAuthProviders({ namespace: 'alpha' }, scope);

    expect(result.providers).toHaveLength(1);
  });

  it('throws ForbiddenError for a member-role caller', async () => {
    const scope = createTestScope({
      oauthProviderRepo: repo,
      caller: userCaller('u-member', ['alpha'], memberRoles),
    });

    await expect(
      listOAuthProviders({ namespace: 'alpha' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws ForbiddenError for a non-member caller', async () => {
    const scope = createTestScope({
      oauthProviderRepo: repo,
      caller: userCaller('u-other', ['beta']),
    });

    await expect(
      listOAuthProviders({ namespace: 'alpha' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
