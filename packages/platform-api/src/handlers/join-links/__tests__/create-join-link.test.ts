import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAuditRepository } from '@mediforce/platform-core/testing';
import {
  InMemoryJoinLinkService,
  InMemoryNamespaceRepo,
  createTestScope,
  userCaller,
} from '../../../testing/index';
import { createJoinLink } from '../create-join-link';
import { hashJoinToken } from '../../../services/join-link';
import { ForbiddenError, NotFoundError, PreconditionFailedError } from '../../../errors';

type Membership = 'owner' | 'admin' | 'member';
const adminRoles = new Map<string, Membership>([['alpha', 'admin']]);
const memberRoles = new Map<string, Membership>([['alpha', 'member']]);

function organizationRepo(): InMemoryNamespaceRepo {
  const repo = new InMemoryNamespaceRepo();
  repo.seedNamespace({
    handle: 'alpha',
    type: 'organization',
    displayName: 'Alpha Labs',
    createdAt: new Date().toISOString(),
  });
  return repo;
}

describe('createJoinLink handler', () => {
  let namespaceRepo: InMemoryNamespaceRepo;
  let auditRepo: InMemoryAuditRepository;
  let joinLinkService: InMemoryJoinLinkService;

  beforeEach(() => {
    namespaceRepo = organizationRepo();
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

  it('mints a link, returns the plaintext token once, and stores only its hash', async () => {
    const result = await createJoinLink(
      { namespaceHandle: 'alpha', membership: 'member', expiresInDays: 7 },
      scopeFor(),
    );

    expect(result.token.length).toBeGreaterThan(20);
    expect(result.url).toContain(`/join/${result.token}`);
    expect(result.link.status).toBe('active');
    expect(result.link.membership).toBe('member');
    expect(result.link.uses).toBe(0);
    expect(result.link.maxUses).toBeNull();

    // The store must not be able to hand the token back: only the hash resolves.
    const found = await joinLinkService.find(hashJoinToken(result.token), new Date());
    expect(found.ok).toBe(true);
    expect(JSON.stringify(await joinLinkService.listForWorkspace('alpha'))).not.toContain(
      result.token,
    );
  });

  it('honours the expiry window and the use cap', async () => {
    const before = Date.now();
    const result = await createJoinLink(
      { namespaceHandle: 'alpha', membership: 'admin', expiresInDays: 1, maxUses: 30 },
      scopeFor(),
    );

    const expiresAt = Date.parse(result.link.expiresAt);
    expect(expiresAt).toBeGreaterThan(before);
    expect(expiresAt).toBeLessThanOrEqual(before + 24 * 60 * 60 * 1000 + 5_000);
    expect(result.link.maxUses).toBe(30);
    expect(result.link.membership).toBe('admin');
  });

  it('refuses a personal workspace — strangers do not join somebody’s own space', async () => {
    namespaceRepo.seedNamespace({
      handle: 'alpha',
      type: 'personal',
      displayName: 'Ada',
      linkedUserId: 'admin-1',
      createdAt: new Date().toISOString(),
    });

    await expect(
      createJoinLink({ namespaceHandle: 'alpha', membership: 'member', expiresInDays: 7 }, scopeFor()),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
  });

  it('404s for a workspace that does not exist', async () => {
    namespaceRepo.namespaces.delete('alpha');

    await expect(
      createJoinLink({ namespaceHandle: 'alpha', membership: 'member', expiresInDays: 7 }, scopeFor()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a plain member — minting is the same gate as inviting', async () => {
    await expect(
      createJoinLink(
        { namespaceHandle: 'alpha', membership: 'member', expiresInDays: 7 },
        scopeFor(memberRoles),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('fails cleanly when the deployment has no join-link store', async () => {
    const scope = createTestScope({
      caller: userCaller('admin-1', ['alpha'], adminRoles),
      namespaceRepo,
      auditRepo,
      joinLinkService: null,
    });

    await expect(
      createJoinLink({ namespaceHandle: 'alpha', membership: 'member', expiresInDays: 7 }, scope),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
  });

  it('audits the creation without recording the token', async () => {
    const result = await createJoinLink(
      { namespaceHandle: 'alpha', membership: 'member', expiresInDays: 7 },
      scopeFor(),
    );

    // Filed under the workspace: the Postgres audit row's `workspace` is NOT
    // NULL, and the in-memory repo throws on a workspace-level event without
    // it, so reading it back by namespace is what proves the handler supplied
    // one rather than relying on a lenient fake.
    const [event] = (await auditRepo.getByNamespace('alpha')).items;
    expect(event?.action).toBe('invitation.link_created');
    expect(event?.entityId).toBe(result.link.id);
    // An audit reader must not be able to redeem what they are auditing.
    expect(JSON.stringify(event)).not.toContain(result.token);
  });
});
