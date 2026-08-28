import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAuditRepository, InMemoryUserDirectoryService } from '@mediforce/platform-core/testing';
import { setNamespaceMemberRoles } from '../set-member-roles';
import { ForbiddenError, NotFoundError, PreconditionFailedError } from '../../../errors';
import { InMemoryNamespaceRepo, createTestScope, userCaller } from '../../../testing/index';

const HANDLE = 'acme';
const OTHER_HANDLE = 'other';
const TEALFLOW = 'tealflow';

const ownerCaller = userCaller('uid-owner', [HANDLE], new Map([[HANDLE, 'owner']]));
const adminCaller = userCaller('uid-admin', [HANDLE], new Map([[HANDLE, 'admin']]));
const memberCaller = userCaller('uid-member', [HANDLE], new Map([[HANDLE, 'member']]));

function seededRepo(): InMemoryNamespaceRepo {
  const repo = new InMemoryNamespaceRepo();
  for (const handle of [HANDLE, OTHER_HANDLE]) {
    repo.seedNamespace({
      handle,
      type: 'organization',
      displayName: handle,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  }
  repo.seedMember(HANDLE, { uid: 'uid-owner', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' });
  repo.seedMember(HANDLE, { uid: 'uid-admin', role: 'admin', joinedAt: '2026-01-02T00:00:00.000Z' });
  repo.seedMember(HANDLE, { uid: 'uid-member', role: 'member', joinedAt: '2026-01-03T00:00:00.000Z' });
  repo.seedMember(OTHER_HANDLE, { uid: 'uid-member', role: 'member', joinedAt: '2026-01-04T00:00:00.000Z' });
  return repo;
}

describe('setNamespaceMemberRoles handler', () => {
  let namespaceRepo: InMemoryNamespaceRepo;
  let auditRepo: InMemoryAuditRepository;
  let directory: InMemoryUserDirectoryService;

  beforeEach(() => {
    namespaceRepo = seededRepo();
    auditRepo = new InMemoryAuditRepository();
    directory = new InMemoryUserDirectoryService();
    directory.addUser({ uid: 'uid-member', email: 'member@acme.test' });
    // Membership is what `setRolesForUser` checks under its own lock, so the
    // directory double carries the same roster the repo was seeded with.
    for (const uid of ['uid-owner', 'uid-admin', 'uid-member']) {
      directory.addMember(uid, HANDLE);
    }
    directory.addMember('uid-member', OTHER_HANDLE);
  });

  function scopeFor(caller = ownerCaller) {
    return createTestScope({ namespaceRepo, auditRepo, userDirectory: directory, caller });
  }

  it('grants workspace-wide and workflow-narrowed roles in one call', async () => {
    const result = await setNamespaceMemberRoles(
      {
        handle: HANDLE,
        uid: 'uid-member',
        grants: [
          { role: 'reviewer', workflowName: null },
          { role: 'approver', workflowName: TEALFLOW },
        ],
      },
      scopeFor(),
    );

    expect(result).toEqual({
      handle: HANDLE,
      uid: 'uid-member',
      grants: [
        { role: 'reviewer', workflowName: null },
        { role: 'approver', workflowName: TEALFLOW },
      ],
    });
    expect((await directory.getRolesForUser('uid-member', HANDLE)).sort()).toEqual([
      'approver',
      'reviewer',
    ]);
    // The narrowed grant answers for its workflow and no other.
    expect(await directory.getRolesForUser('uid-member', HANDLE, 'otherflow')).toEqual(['reviewer']);
  });

  it('replaces the previous set rather than adding to it, and an empty array clears', async () => {
    await setNamespaceMemberRoles(
      { handle: HANDLE, uid: 'uid-member', grants: [{ role: 'reviewer', workflowName: null }] },
      scopeFor(),
    );
    await setNamespaceMemberRoles(
      { handle: HANDLE, uid: 'uid-member', grants: [{ role: 'approver', workflowName: null }] },
      scopeFor(),
    );
    expect(await directory.getRolesForUser('uid-member', HANDLE)).toEqual(['approver']);

    await setNamespaceMemberRoles(
      { handle: HANDLE, uid: 'uid-member', grants: [] },
      scopeFor(),
    );
    expect(await directory.getRolesForUser('uid-member', HANDLE)).toEqual([]);
  });

  it('leaves the same user’s roles in other workspaces alone', async () => {
    directory.addRole('uid-member', OTHER_HANDLE, 'reviewer');

    await setNamespaceMemberRoles(
      { handle: HANDLE, uid: 'uid-member', grants: [] },
      scopeFor(),
    );

    expect(await directory.getRolesForUser('uid-member', OTHER_HANDLE)).toEqual(['reviewer']);
  });

  it('accepts an admin caller and rejects a plain member', async () => {
    await expect(
      setNamespaceMemberRoles(
        { handle: HANDLE, uid: 'uid-member', grants: [{ role: 'reviewer', workflowName: null }] },
        scopeFor(adminCaller),
      ),
    ).resolves.toBeTruthy();

    await expect(
      setNamespaceMemberRoles(
        { handle: HANDLE, uid: 'uid-owner', grants: [{ role: 'reviewer', workflowName: null }] },
        scopeFor(memberCaller),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('404s for an unknown workspace and for a target who is not a member', async () => {
    await expect(
      setNamespaceMemberRoles(
        { handle: 'nope', uid: 'uid-member', grants: [] },
        createTestScope({
          namespaceRepo,
          auditRepo,
          userDirectory: directory,
          caller: userCaller('uid-owner', ['nope'], new Map([['nope', 'owner']])),
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Roles compose with Membership by AND, so a grant to a non-member
    // authorises nothing — but it survives, invisible, and takes effect the day
    // they are added. The grant path refuses to create that row.
    await expect(
      setNamespaceMemberRoles(
        { handle: HANDLE, uid: 'stranger', grants: [{ role: 'reviewer', workflowName: null }] },
        scopeFor(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('404s when the target stops being a member between the read and the write', async () => {
    // The repo still lists uid-ghost; storage does not. That is the shape of a
    // removal committing mid-request — the window a `getMember` pre-check in
    // this handler could not have closed. The refusal has to come from the
    // write, and it has to reach the caller as the same 404.
    namespaceRepo.seedMember(HANDLE, {
      uid: 'uid-ghost',
      role: 'member',
      joinedAt: '2026-01-05T00:00:00.000Z',
    });

    await expect(
      setNamespaceMemberRoles(
        { handle: HANDLE, uid: 'uid-ghost', grants: [{ role: 'reviewer', workflowName: null }] },
        scopeFor(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(await directory.getRolesForUser('uid-ghost', HANDLE)).toEqual([]);
    expect(auditRepo.getAll().filter((e) => e.action === 'namespace.member_roles_updated')).toEqual(
      [],
    );
  });

  it('fails loudly when no user directory is wired', async () => {
    await expect(
      setNamespaceMemberRoles(
        { handle: HANDLE, uid: 'uid-member', grants: [{ role: 'reviewer', workflowName: null }] },
        createTestScope({ namespaceRepo, auditRepo, userDirectory: null, caller: ownerCaller }),
      ),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
  });

  it('emits a member_roles_updated audit event carrying the previous roles', async () => {
    directory.addRole('uid-member', HANDLE, 'reviewer');

    await setNamespaceMemberRoles(
      { handle: HANDLE, uid: 'uid-member', grants: [{ role: 'approver', workflowName: TEALFLOW }] },
      scopeFor(),
    );

    const event = auditRepo.getAll().find((e) => e.action === 'namespace.member_roles_updated');
    expect(event).toBeDefined();
    expect(event?.entityId).toBe(HANDLE);
    expect(event?.actorId).toBe('uid-owner');
    expect(event?.outputSnapshot).toMatchObject({ previousRoles: ['reviewer'] });
    expect(event?.description).toContain('approver@tealflow');
  });
});
