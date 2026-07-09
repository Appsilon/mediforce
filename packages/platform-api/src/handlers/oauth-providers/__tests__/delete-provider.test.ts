import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAuditRepository, InMemoryOAuthProviderRepository } from '@mediforce/platform-core/testing';
import { deleteOAuthProvider } from '../delete-provider';
import { ForbiddenError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import { adminRoles, memberRoles, sampleProviderInput } from './fixtures';

describe('deleteOAuthProvider handler', () => {
  let repo: InMemoryOAuthProviderRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(async () => {
    repo = new InMemoryOAuthProviderRepository();
    auditRepo = new InMemoryAuditRepository();
    await repo.create('alpha', sampleProviderInput);
  });

  it('deletes a provider for an admin caller and writes audit', async () => {
    const scope = createTestScope({
      oauthProviderRepo: repo,
      auditRepo,
      caller: userCaller('u-admin', ['alpha'], adminRoles),
    });

    const result = await deleteOAuthProvider(
      { namespace: 'alpha', id: 'github' },
      scope,
    );

    expect(result.success).toBe(true);
    expect(await repo.get('alpha', 'github')).toBeNull();

    const events = await auditRepo.getByEntity('oauthProvider', 'github');
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('oauth_provider.deleted');
  });

  it('is idempotent when the provider does not exist (no audit)', async () => {
    const scope = createTestScope({
      oauthProviderRepo: repo,
      auditRepo,
      caller: userCaller('u-admin', ['alpha'], adminRoles),
    });

    const result = await deleteOAuthProvider(
      { namespace: 'alpha', id: 'missing' },
      scope,
    );

    expect(result.success).toBe(true);
    const events = await auditRepo.getByEntity('oauthProvider', 'missing');
    expect(events).toHaveLength(0);
  });

  it('throws ForbiddenError for a member-role caller', async () => {
    const scope = createTestScope({
      oauthProviderRepo: repo,
      auditRepo,
      caller: userCaller('u-member', ['alpha'], memberRoles),
    });

    await expect(
      deleteOAuthProvider({ namespace: 'alpha', id: 'github' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(await repo.get('alpha', 'github')).not.toBeNull();
  });
});
