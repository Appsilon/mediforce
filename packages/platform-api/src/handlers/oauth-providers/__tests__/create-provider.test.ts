import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAuditRepository, InMemoryOAuthProviderRepository } from '@mediforce/platform-core/testing';
import { createOAuthProvider } from '../create-provider.js';
import { ForbiddenError, HandlerError } from '../../../errors.js';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope.js';
import { adminRoles, memberRoles, ownerRoles, sampleProviderInput } from './fixtures.js';

describe('createOAuthProvider handler', () => {
  let repo: InMemoryOAuthProviderRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    repo = new InMemoryOAuthProviderRepository();
    auditRepo = new InMemoryAuditRepository();
  });

  it('creates a provider for an admin caller and writes audit', async () => {
    const scope = createTestScope({
      oauthProviderRepo: repo,
      auditRepo,
      caller: userCaller('u-admin', ['alpha'], adminRoles),
    });

    const result = await createOAuthProvider(
      { namespace: 'alpha', ...sampleProviderInput },
      scope,
    );

    expect(result.provider.id).toBe('github');
    expect(result.provider).not.toHaveProperty('clientSecret');
    expect(await repo.get('alpha', 'github')).not.toBeNull();

    const events = await auditRepo.getByEntity('oauthProvider', 'github');
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('oauth_provider.created');
    expect(events[0].actorId).toBe('u-admin');
  });

  it('creates a provider for an owner caller', async () => {
    const scope = createTestScope({
      oauthProviderRepo: repo,
      auditRepo,
      caller: userCaller('u-owner', ['alpha'], ownerRoles),
    });

    const result = await createOAuthProvider(
      { namespace: 'alpha', ...sampleProviderInput },
      scope,
    );

    expect(result.provider.id).toBe('github');
  });

  it('creates a provider for an api-key caller', async () => {
    const scope = createTestScope({ oauthProviderRepo: repo, auditRepo });

    const result = await createOAuthProvider(
      { namespace: 'alpha', ...sampleProviderInput },
      scope,
    );

    expect(result.provider.id).toBe('github');
    const events = await auditRepo.getByEntity('oauthProvider', 'github');
    expect(events[0].actorType).toBe('system');
  });

  it('throws ForbiddenError for a member-role caller', async () => {
    const scope = createTestScope({
      oauthProviderRepo: repo,
      auditRepo,
      caller: userCaller('u-member', ['alpha'], memberRoles),
    });

    await expect(
      createOAuthProvider({ namespace: 'alpha', ...sampleProviderInput }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(await repo.get('alpha', 'github')).toBeNull();
  });

  it('throws conflict HandlerError when the id is already taken', async () => {
    await repo.create('alpha', sampleProviderInput);
    const scope = createTestScope({
      oauthProviderRepo: repo,
      auditRepo,
      caller: userCaller('u-admin', ['alpha'], adminRoles),
    });

    const promise = createOAuthProvider(
      { namespace: 'alpha', ...sampleProviderInput },
      scope,
    );

    await expect(promise).rejects.toBeInstanceOf(HandlerError);
    await expect(promise).rejects.toMatchObject({ code: 'conflict' });
  });
});
