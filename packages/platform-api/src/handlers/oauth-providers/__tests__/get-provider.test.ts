import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryOAuthProviderRepository } from '@mediforce/platform-core/testing';
import { getOAuthProvider } from '../get-provider';
import { ForbiddenError, NotFoundError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import { adminRoles, memberRoles, sampleProviderInput } from './fixtures';

describe('getOAuthProvider handler', () => {
  let repo: InMemoryOAuthProviderRepository;

  beforeEach(async () => {
    repo = new InMemoryOAuthProviderRepository();
    await repo.create('alpha', sampleProviderInput);
  });

  it('returns a provider by id for an admin caller', async () => {
    const scope = createTestScope({
      oauthProviderRepo: repo,
      caller: userCaller('u-admin', ['alpha'], adminRoles),
    });

    const result = await getOAuthProvider(
      { namespace: 'alpha', id: 'github' },
      scope,
    );

    expect(result.provider.id).toBe('github');
    expect(result.provider).not.toHaveProperty('clientSecret');
  });

  it('throws NotFoundError when the provider id is missing', async () => {
    const scope = createTestScope({ oauthProviderRepo: repo });

    await expect(
      getOAuthProvider({ namespace: 'alpha', id: 'missing' }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ForbiddenError for a member-role caller (before lookup)', async () => {
    const scope = createTestScope({
      oauthProviderRepo: repo,
      caller: userCaller('u-member', ['alpha'], memberRoles),
    });

    await expect(
      getOAuthProvider({ namespace: 'alpha', id: 'github' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
