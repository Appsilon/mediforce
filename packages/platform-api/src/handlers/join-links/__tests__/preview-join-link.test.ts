import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAuditRepository } from '@mediforce/platform-core/testing';
import {
  InMemoryJoinLinkService,
  InMemoryNamespaceRepo,
  createTestScope,
  userCaller,
} from '../../../testing/index';
import { createJoinLink } from '../create-join-link';
import { previewJoinLink } from '../preview-join-link';
import { revokeJoinLink } from '../revoke-join-link';
import { listJoinLinks } from '../list-join-links';
import { PreconditionFailedError } from '../../../errors';

const adminRoles = new Map<string, 'owner' | 'admin' | 'member'>([['alpha', 'admin']]);

describe('previewJoinLink handler', () => {
  let namespaceRepo: InMemoryNamespaceRepo;
  let auditRepo: InMemoryAuditRepository;
  let joinLinkService: InMemoryJoinLinkService;

  beforeEach(() => {
    namespaceRepo = new InMemoryNamespaceRepo();
    namespaceRepo.seedNamespace({
      handle: 'alpha',
      type: 'organization',
      displayName: 'Alpha Labs',
      createdAt: new Date().toISOString(),
    });
    auditRepo = new InMemoryAuditRepository();
    joinLinkService = new InMemoryJoinLinkService();
  });

  function adminScope() {
    return createTestScope({
      caller: userCaller('admin-1', ['alpha'], adminRoles),
      namespaceRepo,
      auditRepo,
      joinLinkService,
    });
  }

  /**
   * The public surface has no caller at all. Previewing with a system scope is
   * the production shape, and it is what proves the handler does not quietly
   * depend on `scope.caller`.
   */
  function publicScope() {
    return createTestScope({ namespaceRepo, auditRepo, joinLinkService });
  }

  it('names the workspace and the membership a live token grants', async () => {
    const created = await createJoinLink(
      { namespaceHandle: 'alpha', membership: 'admin', expiresInDays: 7 },
      adminScope(),
    );

    expect(await previewJoinLink({ token: created.token }, publicScope())).toEqual({
      ok: true,
      namespaceHandle: 'alpha',
      workspaceName: 'Alpha Labs',
      membership: 'admin',
    });
  });

  it('answers not_found for an unknown token', async () => {
    expect(await previewJoinLink({ token: 'not-a-real-token' }, publicScope())).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('names a revoked token plainly — the holder has the secret, so this leaks nothing', async () => {
    const scope = adminScope();
    const created = await createJoinLink(
      { namespaceHandle: 'alpha', membership: 'member', expiresInDays: 7 },
      scope,
    );
    await revokeJoinLink({ namespaceHandle: 'alpha', id: created.link.id }, scope);

    expect(await previewJoinLink({ token: created.token }, publicScope())).toEqual({
      ok: false,
      reason: 'revoked',
    });
  });

  it('consumes nothing — opening the page must not spend a seat', async () => {
    const scope = adminScope();
    const created = await createJoinLink(
      { namespaceHandle: 'alpha', membership: 'member', expiresInDays: 7, maxUses: 1 },
      scope,
    );

    await previewJoinLink({ token: created.token }, publicScope());
    await previewJoinLink({ token: created.token }, publicScope());

    const { links } = await listJoinLinks({ namespaceHandle: 'alpha' }, scope);
    expect(links[0]?.uses).toBe(0);
    expect(links[0]?.status).toBe('active');
  });

  it('falls back to the handle when the workspace has no display name to read', async () => {
    const created = await createJoinLink(
      { namespaceHandle: 'alpha', membership: 'member', expiresInDays: 7 },
      adminScope(),
    );
    namespaceRepo.namespaces.delete('alpha');

    expect(await previewJoinLink({ token: created.token }, publicScope())).toEqual({
      ok: true,
      namespaceHandle: 'alpha',
      workspaceName: 'alpha',
      membership: 'member',
    });
  });

  it('fails cleanly when the deployment has no join-link store', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, joinLinkService: null });

    await expect(previewJoinLink({ token: 'anything' }, scope)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
  });
});
