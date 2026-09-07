import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAuditRepository } from '@mediforce/platform-core/testing';
import {
  InMemoryJoinLinkService,
  InMemoryNamespaceRepo,
  createTestScope,
  userCaller,
} from '../../../testing/index';
import { createJoinLink } from '../create-join-link';
import { listJoinLinks } from '../list-join-links';
import { revokeJoinLink } from '../revoke-join-link';
import { ForbiddenError, PreconditionFailedError } from '../../../errors';

type Membership = 'owner' | 'admin' | 'member';
const adminRoles = new Map<string, Membership>([['alpha', 'admin']]);
const memberRoles = new Map<string, Membership>([['alpha', 'member']]);

describe('listJoinLinks handler', () => {
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
    });
  }

  it('returns an empty list for a workspace that has never minted one', async () => {
    expect(await listJoinLinks({ namespaceHandle: 'alpha' }, scopeFor())).toEqual({ links: [] });
  });

  it('keeps revoked links in the list — a closed entrance is the answer to "was it closed?"', async () => {
    const scope = scopeFor();
    const live = await createJoinLink(
      { namespaceHandle: 'alpha', membership: 'member', expiresInDays: 7 },
      scope,
    );
    const closed = await createJoinLink(
      { namespaceHandle: 'alpha', membership: 'admin', expiresInDays: 7 },
      scope,
    );
    await revokeJoinLink({ namespaceHandle: 'alpha', id: closed.link.id }, scope);

    const { links } = await listJoinLinks({ namespaceHandle: 'alpha' }, scope);
    const byId = new Map(links.map((link) => [link.id, link]));
    expect(byId.get(live.link.id)?.status).toBe('active');
    expect(byId.get(closed.link.id)?.status).toBe('revoked');
  });

  it('never returns a token or its hash', async () => {
    const scope = scopeFor();
    const created = await createJoinLink(
      { namespaceHandle: 'alpha', membership: 'member', expiresInDays: 7 },
      scope,
    );

    const { links } = await listJoinLinks({ namespaceHandle: 'alpha' }, scope);
    const serialized = JSON.stringify(links);
    expect(serialized).not.toContain(created.token);
    expect(serialized).not.toContain('tokenHash');
  });

  it('refuses a plain member', async () => {
    await expect(
      listJoinLinks({ namespaceHandle: 'alpha' }, scopeFor(memberRoles)),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('fails cleanly when the deployment has no join-link store', async () => {
    const scope = createTestScope({
      caller: userCaller('admin-1', ['alpha'], adminRoles),
      namespaceRepo,
      auditRepo,
      joinLinkService: null,
    });

    await expect(listJoinLinks({ namespaceHandle: 'alpha' }, scope)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
  });
});
