import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAuditRepository, InMemoryOAuthProviderRepository } from '@mediforce/platform-core/testing';
import { updateOAuthProvider } from '../update-provider';
import { ForbiddenError, NotFoundError } from '../../../errors';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import { adminRoles, memberRoles, sampleProviderInput } from './fixtures';

describe('updateOAuthProvider handler', () => {
  let repo: InMemoryOAuthProviderRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(async () => {
    repo = new InMemoryOAuthProviderRepository();
    auditRepo = new InMemoryAuditRepository();
    await repo.create('alpha', sampleProviderInput);
  });

  it('updates a provider for an admin caller and writes audit', async () => {
    const scope = createTestScope({
      oauthProviderRepo: repo,
      auditRepo,
      caller: userCaller('u-admin', ['alpha'], adminRoles),
    });

    const result = await updateOAuthProvider({ namespace: 'alpha', id: 'github', name: 'GitHub Enterprise' }, scope);

    expect(result.provider.name).toBe('GitHub Enterprise');
    expect(result.provider).not.toHaveProperty('clientSecret');

    const events = await auditRepo.getByEntity('oauthProvider', 'github');
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('oauth_provider.updated');
  });

  it('throws NotFoundError when the provider does not exist', async () => {
    const scope = createTestScope({ oauthProviderRepo: repo, auditRepo });

    await expect(updateOAuthProvider({ namespace: 'alpha', id: 'missing', name: 'X' }, scope)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('throws ForbiddenError for a member-role caller', async () => {
    const scope = createTestScope({
      oauthProviderRepo: repo,
      auditRepo,
      caller: userCaller('u-member', ['alpha'], memberRoles),
    });

    await expect(updateOAuthProvider({ namespace: 'alpha', id: 'github', name: 'X' }, scope)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
