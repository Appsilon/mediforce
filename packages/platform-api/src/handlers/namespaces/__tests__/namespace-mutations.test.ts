import { describe, it, expect, beforeEach } from 'vitest';
import type { AuditEvent } from '@mediforce/platform-core';
import { InMemoryAuditRepository } from '@mediforce/platform-core/testing';
import {
  deleteNamespace,
  leaveNamespace,
  removeNamespaceMember,
  updateNamespace,
  updateNamespaceMemberRole,
} from '../namespace-mutations';
import { ForbiddenError, NotFoundError, PreconditionFailedError } from '../../../errors';
import { InMemoryNamespaceRepo, createTestScope, userCaller } from '../../../testing/index';

/**
 * `InMemoryAuditRepository` strips the write-time `namespace` hint before
 * storing, so `getAll()` cannot prove a handler supplied the FK-valid
 * workspace the Postgres backend requires (RC2). This double records the raw
 * `namespace` passed to `append` so tests can assert it directly.
 */
class RecordingAuditRepo extends InMemoryAuditRepository {
  readonly appendedNamespaces: (string | undefined)[] = [];
  override async append(
    event: Omit<AuditEvent, 'serverTimestamp'>,
  ): Promise<AuditEvent> {
    this.appendedNamespaces.push(event.namespace);
    return super.append(event);
  }
}

/**
 * `InMemoryNamespaceRepo` that records the relative order of an audit emit vs.
 * the cascade delete — `deleteNamespace` must emit BEFORE the cascade so the
 * audit row's workspace FK still resolves (and is anchored to a surviving
 * workspace).
 */
class OrderedNamespaceRepo extends InMemoryNamespaceRepo {
  cascadeAt = -1;
  private clock: () => number = () => -1;
  bindClock(clock: () => number): void {
    this.clock = clock;
  }
  override async deleteNamespaceCascade(handle: string): Promise<void> {
    this.cascadeAt = this.clock();
    await super.deleteNamespaceCascade(handle);
  }
}

const HANDLE = 'acme';
const ownerCaller = userCaller('uid-owner', [HANDLE], new Map([[HANDLE, 'owner']]));
const adminCaller = userCaller('uid-admin', [HANDLE], new Map([[HANDLE, 'admin']]));
const memberCaller = userCaller('uid-member', [HANDLE], new Map([[HANDLE, 'member']]));

function seededRepo(): InMemoryNamespaceRepo {
  const repo = new InMemoryNamespaceRepo();
  repo.seedNamespace({
    handle: HANDLE,
    type: 'organization',
    displayName: 'Acme Co.',
    bio: 'Widgets',
    icon: 'Building2',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  repo.seedMember(HANDLE, { uid: 'uid-owner', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' });
  repo.seedMember(HANDLE, { uid: 'uid-member', role: 'member', joinedAt: '2026-01-02T00:00:00.000Z' });
  repo.seedMember(HANDLE, { uid: 'uid-admin', role: 'admin', joinedAt: '2026-01-03T00:00:00.000Z' });
  return repo;
}

describe('updateNamespace handler', () => {
  let namespaceRepo: InMemoryNamespaceRepo;
  let auditRepo: InMemoryAuditRepository;
  beforeEach(() => {
    namespaceRepo = seededRepo();
    auditRepo = new InMemoryAuditRepository();
  });

  it('updates displayName/bio/icon and returns the entity-echo', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, caller: ownerCaller });
    const result = await updateNamespace(
      { handle: HANDLE, displayName: 'Acme Inc.', icon: 'Briefcase', bio: 'New tagline' },
      scope,
    );
    expect(result.namespace).toMatchObject({ displayName: 'Acme Inc.', icon: 'Briefcase', bio: 'New tagline' });
    expect(namespaceRepo.namespaces.get(HANDLE)?.displayName).toBe('Acme Inc.');
  });

  it('clears bio when passed an empty string', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, caller: ownerCaller });
    await updateNamespace({ handle: HANDLE, bio: '' }, scope);
    expect(namespaceRepo.namespaces.get(HANDLE)?.bio).toBe('');
  });

  it('updates logo and brand colors, returns the entity-echo', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, caller: ownerCaller });
    const logo = 'data:image/png;base64,iVBORw0KGgo=';
    const result = await updateNamespace(
      { handle: HANDLE, logo, brandPrimaryColor: '#0d9488', brandAccentColor: '#f59e0b' },
      scope,
    );
    expect(result.namespace).toMatchObject({
      logo,
      brandPrimaryColor: '#0d9488',
      brandAccentColor: '#f59e0b',
    });
    expect(namespaceRepo.namespaces.get(HANDLE)?.logo).toBe(logo);
  });

  it('clears logo and brand colors when passed empty strings', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, caller: ownerCaller });
    await updateNamespace(
      { handle: HANDLE, logo: 'data:image/png;base64,iVBORw0KGgo=', brandPrimaryColor: '#0d9488' },
      scope,
    );
    await updateNamespace({ handle: HANDLE, logo: '', brandPrimaryColor: '' }, scope);
    expect(namespaceRepo.namespaces.get(HANDLE)?.logo).toBe('');
    expect(namespaceRepo.namespaces.get(HANDLE)?.brandPrimaryColor).toBe('');
  });

  it('does not dump the base64 logo into the audit snapshot', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, caller: ownerCaller });
    const logo = `data:image/png;base64,${'A'.repeat(4096)}`;
    await updateNamespace({ handle: HANDLE, logo }, scope);
    const event = auditRepo.getAll().find((e) => e.action === 'namespace.updated');
    expect(event?.inputSnapshot).toMatchObject({ handle: HANDLE, logo: 'updated' });
    expect(JSON.stringify(event?.inputSnapshot).length).toBeLessThan(200);
  });

  it('admins may edit (not just owners)', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, caller: adminCaller });
    await expect(
      updateNamespace({ handle: HANDLE, displayName: 'Edited' }, scope),
    ).resolves.toMatchObject({ namespace: { displayName: 'Edited' } });
  });

  it('rejects non-admin members with ForbiddenError', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, caller: memberCaller });
    await expect(
      updateNamespace({ handle: HANDLE, displayName: 'Nope' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(namespaceRepo.namespaces.get(HANDLE)?.displayName).toBe('Acme Co.');
  });

  it('throws NotFoundError when the namespace does not exist', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-owner', ['unknown'], new Map([['unknown', 'owner']])),
    });
    await expect(
      updateNamespace({ handle: 'unknown', displayName: 'X' }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('emits namespace.updated with the input snapshot', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, caller: ownerCaller });
    await updateNamespace({ handle: HANDLE, displayName: 'New' }, scope);
    const events = auditRepo.getAll().filter((e) => e.action === 'namespace.updated');
    expect(events).toHaveLength(1);
    expect(events[0]?.entityId).toBe(HANDLE);
    expect(events[0]?.actorId).toBe('uid-owner');
  });
});

describe('deleteNamespace handler', () => {
  let namespaceRepo: InMemoryNamespaceRepo;
  let auditRepo: InMemoryAuditRepository;
  // The owner's personal namespace anchors the deletion audit (survives the
  // workspace cascade). Seeded only by the tests that reach the audit emit.
  function seedOwnerPersonal(): void {
    namespaceRepo.seedNamespace({
      handle: 'uid-owner',
      type: 'personal',
      displayName: 'Owner',
      linkedUserId: 'uid-owner',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    namespaceRepo.seedMember('uid-owner', { uid: 'uid-owner', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' });
  }
  beforeEach(() => {
    namespaceRepo = seededRepo();
    auditRepo = new InMemoryAuditRepository();
  });

  it('cascade deletes the namespace, every member, and arrayRemoves organizations', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, caller: ownerCaller });
    const result = await deleteNamespace({ handle: HANDLE }, scope);
    expect(result).toEqual({ handle: HANDLE });
    expect(namespaceRepo.namespaces.get(HANDLE)).toBeUndefined();
    expect(namespaceRepo.members.get(HANDLE)).toBeUndefined();
    for (const uid of ['uid-owner', 'uid-member', 'uid-admin']) {
      expect(namespaceRepo.userOrganizations.get(uid)).toEqual([]);
    }
  });

  it('rejects admin role with ForbiddenError (owner only)', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, caller: adminCaller });
    await expect(deleteNamespace({ handle: HANDLE }, scope)).rejects.toBeInstanceOf(ForbiddenError);
    expect(namespaceRepo.namespaces.get(HANDLE)).toBeDefined();
  });

  it('rejects member role with ForbiddenError', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, caller: memberCaller });
    await expect(deleteNamespace({ handle: HANDLE }, scope)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws NotFoundError when the namespace does not exist', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-owner', ['ghost'], new Map([['ghost', 'owner']])),
    });
    await expect(deleteNamespace({ handle: 'ghost' }, scope)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('emits namespace.deleted exactly once on success', async () => {
    seedOwnerPersonal();
    const scope = createTestScope({ namespaceRepo, auditRepo, caller: ownerCaller });
    await deleteNamespace({ handle: HANDLE }, scope);
    const events = auditRepo.getAll().filter((e) => e.action === 'namespace.deleted');
    expect(events).toHaveLength(1);
    expect(events[0]?.entityId).toBe(HANDLE);
  });

  it('anchors the audit event to the owner personal namespace, which survives the cascade', async () => {
    seedOwnerPersonal();
    const recording = new RecordingAuditRepo();
    const scope = createTestScope({ namespaceRepo, auditRepo: recording, caller: ownerCaller });
    await deleteNamespace({ handle: HANDLE }, scope);
    // NOT the deleted org handle — that workspace is gone after the cascade
    // (audit_events.workspace is ON DELETE CASCADE), so attributing the
    // deletion to it would wipe the row. The owner personal namespace survives.
    expect(recording.appendedNamespaces).toEqual(['uid-owner']);
    expect(namespaceRepo.namespaces.get('uid-owner')).toBeDefined();
  });

  it('emits the audit event BEFORE the cascade delete (FK target still present)', async () => {
    const orderedRepo = new OrderedNamespaceRepo();
    orderedRepo.seedNamespace({
      handle: HANDLE,
      type: 'organization',
      displayName: 'Acme Co.',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    orderedRepo.seedMember(HANDLE, { uid: 'uid-owner', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' });
    orderedRepo.seedNamespace({
      handle: 'uid-owner',
      type: 'personal',
      displayName: 'Owner',
      linkedUserId: 'uid-owner',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    orderedRepo.seedMember('uid-owner', { uid: 'uid-owner', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' });

    let tick = 0;
    let emitAt = -1;
    const recording = new RecordingAuditRepo();
    const originalAppend = recording.append.bind(recording);
    recording.append = async (event) => {
      emitAt = tick++;
      return originalAppend(event);
    };
    orderedRepo.bindClock(() => tick++);

    const scope = createTestScope({ namespaceRepo: orderedRepo, auditRepo: recording, caller: ownerCaller });
    await deleteNamespace({ handle: HANDLE }, scope);

    expect(emitAt).toBeGreaterThanOrEqual(0);
    expect(orderedRepo.cascadeAt).toBeGreaterThan(emitAt);
  });

  it('apiKey caller (no personal namespace) falls back to the deleted handle and still succeeds', async () => {
    const recording = new RecordingAuditRepo();
    const scope = createTestScope({ namespaceRepo, auditRepo: recording });
    const result = await deleteNamespace({ handle: HANDLE }, scope);
    expect(result).toEqual({ handle: HANDLE });
    // FK-valid at insert (emitted before the cascade); no personal namespace
    // to anchor to, so the deleted handle is used.
    expect(recording.appendedNamespaces).toEqual([HANDLE]);
  });
});

describe('leaveNamespace handler', () => {
  let namespaceRepo: InMemoryNamespaceRepo;
  let auditRepo: InMemoryAuditRepository;
  beforeEach(() => {
    namespaceRepo = seededRepo();
    auditRepo = new InMemoryAuditRepository();
  });

  it('removes the caller from the workspace and arrayRemoves organizations', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, caller: memberCaller });
    const result = await leaveNamespace({ handle: HANDLE }, scope);
    expect(result).toEqual({ handle: HANDLE });
    expect(namespaceRepo.members.get(HANDLE)?.map((m) => m.uid)).not.toContain('uid-member');
    expect(namespaceRepo.userOrganizations.get('uid-member')).toEqual([]);
  });

  it('owner cannot leave — precondition_failed', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, caller: ownerCaller });
    await expect(leaveNamespace({ handle: HANDLE }, scope)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
    expect(namespaceRepo.members.get(HANDLE)?.map((m) => m.uid)).toContain('uid-owner');
  });

  it('rejects apiKey caller (no `self` for a system actor)', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo });
    await expect(leaveNamespace({ handle: HANDLE }, scope)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('cannot leave a personal namespace (caught by owner guard)', async () => {
    namespaceRepo.seedNamespace({
      handle: 'marek',
      type: 'personal',
      displayName: 'Marek',
      linkedUserId: 'uid-marek',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    namespaceRepo.seedMember('marek', { uid: 'uid-marek', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-marek', ['marek'], new Map([['marek', 'owner']])),
    });
    await expect(leaveNamespace({ handle: 'marek' }, scope)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
  });

  it('not-found namespace surfaces as NotFoundError', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-member', [], new Map()),
    });
    await expect(leaveNamespace({ handle: 'ghost' }, scope)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('non-member surfaces as anti-enum NotFoundError', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-stranger', [], new Map()),
    });
    await expect(leaveNamespace({ handle: HANDLE }, scope)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('emits namespace.member_left on success', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, caller: memberCaller });
    await leaveNamespace({ handle: HANDLE }, scope);
    const events = auditRepo.getAll().filter((e) => e.action === 'namespace.member_left');
    expect(events).toHaveLength(1);
    expect(events[0]?.actorId).toBe('uid-member');
    expect(events[0]?.entityId).toBe(HANDLE);
  });

  it('attributes the audit event to the mutated workspace (FK-valid on Postgres)', async () => {
    const recording = new RecordingAuditRepo();
    const scope = createTestScope({ namespaceRepo, auditRepo: recording, caller: memberCaller });
    await leaveNamespace({ handle: HANDLE }, scope);
    expect(recording.appendedNamespaces).toEqual([HANDLE]);
  });
});

describe('removeNamespaceMember handler', () => {
  let namespaceRepo: InMemoryNamespaceRepo;
  let auditRepo: InMemoryAuditRepository;
  beforeEach(() => {
    namespaceRepo = seededRepo();
    auditRepo = new InMemoryAuditRepository();
  });

  it('admin removes a regular member; atomic with organizations arrayRemove', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, caller: adminCaller });
    const result = await removeNamespaceMember({ handle: HANDLE, uid: 'uid-member' }, scope);
    expect(result).toEqual({ handle: HANDLE, uid: 'uid-member' });
    expect(namespaceRepo.members.get(HANDLE)?.map((m) => m.uid)).not.toContain('uid-member');
    expect(namespaceRepo.userOrganizations.get('uid-member')).toEqual([]);
  });

  it('member role cannot remove anyone', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, caller: memberCaller });
    await expect(
      removeNamespaceMember({ handle: HANDLE, uid: 'uid-owner' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('cannot remove the workspace owner', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, caller: adminCaller });
    await expect(
      removeNamespaceMember({ handle: HANDLE, uid: 'uid-owner' }, scope),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
    expect(namespaceRepo.members.get(HANDLE)?.map((m) => m.uid)).toContain('uid-owner');
  });

  it('unknown member surfaces as NotFoundError', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, caller: ownerCaller });
    await expect(
      removeNamespaceMember({ handle: HANDLE, uid: 'uid-ghost' }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('emits namespace.member_removed on success', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, caller: ownerCaller });
    await removeNamespaceMember({ handle: HANDLE, uid: 'uid-member' }, scope);
    const events = auditRepo.getAll().filter((e) => e.action === 'namespace.member_removed');
    expect(events).toHaveLength(1);
    expect(events[0]?.entityId).toBe(HANDLE);
  });

  it('attributes the audit event to the mutated workspace (FK-valid on Postgres)', async () => {
    const recording = new RecordingAuditRepo();
    const scope = createTestScope({ namespaceRepo, auditRepo: recording, caller: ownerCaller });
    await removeNamespaceMember({ handle: HANDLE, uid: 'uid-member' }, scope);
    expect(recording.appendedNamespaces).toEqual([HANDLE]);
  });
});

describe('updateNamespaceMemberRole handler', () => {
  let namespaceRepo: InMemoryNamespaceRepo;
  let auditRepo: InMemoryAuditRepository;
  beforeEach(() => {
    namespaceRepo = seededRepo();
    auditRepo = new InMemoryAuditRepository();
  });

  it('owner promotes a member to admin; returns entity-echo', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, caller: ownerCaller });
    const result = await updateNamespaceMemberRole(
      { handle: HANDLE, uid: 'uid-member', role: 'admin' },
      scope,
    );
    expect(result.member.role).toBe('admin');
    expect(namespaceRepo.members.get(HANDLE)?.find((m) => m.uid === 'uid-member')?.role).toBe('admin');
  });

  it('admin cannot change roles (owner-only)', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, caller: adminCaller });
    await expect(
      updateNamespaceMemberRole({ handle: HANDLE, uid: 'uid-member', role: 'admin' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('cannot change the workspace owner’s role', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, caller: ownerCaller });
    await expect(
      updateNamespaceMemberRole({ handle: HANDLE, uid: 'uid-owner', role: 'admin' }, scope),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
  });

  it('unknown member surfaces as NotFoundError', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, caller: ownerCaller });
    await expect(
      updateNamespaceMemberRole({ handle: HANDLE, uid: 'uid-ghost', role: 'admin' }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('emits namespace.member_role_changed on success', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, caller: ownerCaller });
    await updateNamespaceMemberRole({ handle: HANDLE, uid: 'uid-member', role: 'admin' }, scope);
    const events = auditRepo.getAll().filter((e) => e.action === 'namespace.member_role_changed');
    expect(events).toHaveLength(1);
    expect(events[0]?.entityId).toBe(HANDLE);
  });

  it('attributes the audit event to the mutated workspace (FK-valid on Postgres)', async () => {
    const recording = new RecordingAuditRepo();
    const scope = createTestScope({ namespaceRepo, auditRepo: recording, caller: ownerCaller });
    await updateNamespaceMemberRole({ handle: HANDLE, uid: 'uid-member', role: 'admin' }, scope);
    expect(recording.appendedNamespaces).toEqual([HANDLE]);
  });
});
