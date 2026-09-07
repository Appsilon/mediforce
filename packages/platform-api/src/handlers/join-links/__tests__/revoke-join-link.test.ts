import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAuditRepository } from '@mediforce/platform-core/testing';
import {
  InMemoryJoinLinkService,
  InMemoryNamespaceRepo,
  createTestScope,
  userCaller,
} from '../../../testing/index';
import { createJoinLink } from '../create-join-link';
import { revokeJoinLink } from '../revoke-join-link';
import { redeemJoinLink } from '../redeem-join-link';
import { ForbiddenError, NotFoundError } from '../../../errors';
import type { InviteService } from '../../../services/invite-notification';

type Membership = 'owner' | 'admin' | 'member';
const adminRoles = new Map<string, Membership>([['alpha', 'admin']]);
const memberRoles = new Map<string, Membership>([['alpha', 'member']]);

const inviteService: InviteService = {
  async seedInvite() {
    return { uid: 'uid-joiner', isExisting: false };
  },
  async getUserEmail() {
    return null;
  },
  async isInvitePending() {
    return true;
  },
};

describe('revokeJoinLink handler', () => {
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

  function scopeFor(roles = adminRoles) {
    return createTestScope({
      caller: userCaller('admin-1', ['alpha'], roles),
      namespaceRepo,
      auditRepo,
      joinLinkService,
      inviteService,
    });
  }

  it('closes a live link and audits it', async () => {
    const scope = scopeFor();
    const created = await createJoinLink(
      { namespaceHandle: 'alpha', membership: 'member', expiresInDays: 7 },
      scope,
    );

    const result = await revokeJoinLink({ namespaceHandle: 'alpha', id: created.link.id }, scope);

    expect(result.link.status).toBe('revoked');
    expect(result.link.revokedAt).not.toBeNull();
    const actions = (await auditRepo.getByNamespace('alpha')).items.map((e) => e.action);
    expect(actions).toContain('invitation.link_revoked');
  });

  it('stops the link from being redeemed afterwards', async () => {
    const scope = scopeFor();
    const created = await createJoinLink(
      { namespaceHandle: 'alpha', membership: 'member', expiresInDays: 7 },
      scope,
    );
    await revokeJoinLink({ namespaceHandle: 'alpha', id: created.link.id }, scope);

    const redeemed = await redeemJoinLink(
      { token: created.token, email: 'late@example.test' },
      scope,
    );
    expect(redeemed).toEqual({ ok: false, reason: 'revoked' });
  });

  it('404s on a second revoke — there is nothing live left to close', async () => {
    const scope = scopeFor();
    const created = await createJoinLink(
      { namespaceHandle: 'alpha', membership: 'member', expiresInDays: 7 },
      scope,
    );
    await revokeJoinLink({ namespaceHandle: 'alpha', id: created.link.id }, scope);

    await expect(
      revokeJoinLink({ namespaceHandle: 'alpha', id: created.link.id }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('404s for a link id belonging to another workspace', async () => {
    namespaceRepo.seedNamespace({
      handle: 'beta',
      type: 'organization',
      displayName: 'Beta',
      createdAt: new Date().toISOString(),
    });
    const scope = createTestScope({
      caller: userCaller(
        'admin-1',
        ['alpha', 'beta'],
        new Map<string, Membership>([
          ['alpha', 'admin'],
          ['beta', 'admin'],
        ]),
      ),
      namespaceRepo,
      auditRepo,
      joinLinkService,
      inviteService,
    });
    const created = await createJoinLink(
      { namespaceHandle: 'beta', membership: 'member', expiresInDays: 7 },
      scope,
    );

    await expect(
      revokeJoinLink({ namespaceHandle: 'alpha', id: created.link.id }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a plain member', async () => {
    await expect(
      revokeJoinLink({ namespaceHandle: 'alpha', id: 'anything' }, scopeFor(memberRoles)),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
