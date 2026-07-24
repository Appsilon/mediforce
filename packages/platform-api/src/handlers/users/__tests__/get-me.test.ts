import { describe, it, expect, beforeEach } from 'vitest';
import type { UserDirectoryService } from '@mediforce/platform-core';
import { InMemoryAuditRepository } from '@mediforce/platform-core/testing';
import { InMemoryNamespaceRepo, createTestScope, userCaller } from '../../../testing/index';
import { getMe } from '../get-me';
import { ForbiddenError, ValidationError } from '../../../errors';

function directoryWith(uid: string, metadata: { email: string | null; displayName: string | null }): UserDirectoryService {
  return {
    async getUsersByRole() {
      return [];
    },
    async getUserMetadata(requested: string) {
      if (requested !== uid) return null;
      return { ...metadata, lastSignInTime: null, photoURL: null };
    },
  };
}

describe('getMe handler', () => {
  let namespaceRepo: InMemoryNamespaceRepo;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    namespaceRepo = new InMemoryNamespaceRepo();
    auditRepo = new InMemoryAuditRepository();
  });

  it('rejects apiKey caller without an explicit uid (no identity to attribute)', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo });
    await expect(getMe({}, scope)).rejects.toBeInstanceOf(ValidationError);
  });

  it('apiKey caller may target a uid explicitly (admin / CLI escape hatch)', async () => {
    const directory = directoryWith('uid-1', { email: 'alice@example.test', displayName: 'Alice' });
    const scope = createTestScope({ namespaceRepo, auditRepo, userDirectory: directory });

    const result = await getMe({ uid: 'uid-1' }, scope);

    expect(result.user.uid).toBe('uid-1');
    expect(result.namespaces[0]?.handle).toBe('alice');
  });

  it('rejects a user caller asking for a different uid', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-1', []),
    });

    await expect(getMe({ uid: 'uid-other' }, scope)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('creates personal namespace inline when missing and returns it as owner', async () => {
    const directory = directoryWith('uid-1', { email: 'alice@example.test', displayName: 'Alice' });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      userDirectory: directory,
      caller: userCaller('uid-1', []),
    });

    const result = await getMe({}, scope);

    expect(result.user).toEqual({
      uid: 'uid-1',
      email: 'alice@example.test',
      displayName: 'Alice',
      mustChangePassword: false,
      hasPassword: false,
    });
    expect(result.namespaces).toHaveLength(1);
    expect(result.namespaces[0]).toMatchObject({
      handle: 'alice',
      type: 'personal',
      role: 'owner',
    });
    expect(namespaceRepo.namespaces.get('alice')?.linkedUserId).toBe('uid-1');
    const members = namespaceRepo.members.get('alice') ?? [];
    expect(members.map((m) => m.uid)).toEqual(['uid-1']);
  });

  it('emits user.personal_namespace_created exactly once when bootstrap runs', async () => {
    const directory = directoryWith('uid-1', { email: 'alice@example.test', displayName: 'Alice' });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      userDirectory: directory,
      caller: userCaller('uid-1', []),
    });

    await getMe({}, scope);

    const events = auditRepo.getAll().filter((e) => e.action === 'user.personal_namespace_created');
    expect(events).toHaveLength(1);
    expect(events[0]?.entityId).toBe('alice');
  });

  it('does not create or emit when personal namespace already exists', async () => {
    namespaceRepo.seedNamespace({
      handle: 'alice',
      type: 'personal',
      displayName: 'Alice',
      linkedUserId: 'uid-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    namespaceRepo.seedMember('alice', {
      uid: 'uid-1',
      role: 'owner',
      joinedAt: '2026-01-01T00:00:00.000Z',
    });
    const directory = directoryWith('uid-1', { email: 'alice@example.test', displayName: 'Alice' });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      userDirectory: directory,
      caller: userCaller('uid-1', ['alice']),
    });

    const result = await getMe({}, scope);

    expect(result.namespaces).toHaveLength(1);
    expect(result.namespaces[0]?.handle).toBe('alice');
    expect(auditRepo.getAll().some((e) => e.action === 'user.personal_namespace_created')).toBe(false);
  });

  it('is idempotent across repeat calls — only the first creates', async () => {
    const directory = directoryWith('uid-1', { email: 'alice@example.test', displayName: 'Alice' });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      userDirectory: directory,
      caller: userCaller('uid-1', []),
    });

    await getMe({}, scope);
    // Second call: simulate the route layer rebuilding scope.caller from the
    // bootstrapped membership (which is what `resolveCallerIdentity` does).
    const scope2 = createTestScope({
      namespaceRepo,
      auditRepo,
      userDirectory: directory,
      caller: userCaller('uid-1', ['alice'], new Map([['alice', 'owner']])),
    });
    const second = await getMe({}, scope2);

    expect(second.namespaces).toHaveLength(1);
    const createdEvents = auditRepo.getAll().filter((e) => e.action === 'user.personal_namespace_created');
    expect(createdEvents).toHaveLength(1);
  });

  it('includes organization memberships with their role alongside the personal namespace', async () => {
    namespaceRepo.seedNamespace({
      handle: 'acme',
      type: 'organization',
      displayName: 'Acme Co.',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    namespaceRepo.seedMember('acme', {
      uid: 'uid-1',
      role: 'admin',
      joinedAt: '2026-02-01T00:00:00.000Z',
    });
    const directory = directoryWith('uid-1', { email: 'alice@example.test', displayName: 'Alice' });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      userDirectory: directory,
      caller: userCaller('uid-1', ['acme'], new Map([['acme', 'admin']])),
    });

    const result = await getMe({}, scope);

    const handlesAndRoles = result.namespaces.map((n) => [n.handle, n.role]).sort();
    expect(handlesAndRoles).toEqual([
      ['acme', 'admin'],
      ['alice', 'owner'],
    ]);
  });

  it('returns nullable user fields when userDirectory is unconfigured', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      userDirectory: null,
      caller: userCaller('uid-1', []),
    });

    const result = await getMe({}, scope);

    expect(result.user.email).toBeNull();
    expect(result.user.displayName).toBeNull();
    // No userDirectory → email is null, so generateHandle falls back to the
    // uid as seed. `'uid-1'` is already a valid handle, so no further
    // transformation; the PERSONAL_HANDLE_FALLBACK ('user') only kicks in
    // when the seed sanitises down to an empty string.
    expect(result.namespaces[0]?.handle).toBe('uid-1');
  });

  it('appends a numeric suffix when the base handle is already taken', async () => {
    namespaceRepo.seedNamespace({
      handle: 'alice',
      type: 'personal',
      displayName: 'someone else',
      linkedUserId: 'uid-other',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const directory = directoryWith('uid-1', { email: 'alice@example.test', displayName: 'Alice' });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      userDirectory: directory,
      caller: userCaller('uid-1', []),
    });

    const result = await getMe({}, scope);

    expect(result.namespaces[0]?.handle).toBe('alice-2');
    expect(result.namespaces[0]?.role).toBe('owner');
  });

  it('projects mustChangePassword: false when no users/{uid} profile exists', async () => {
    const directory = directoryWith('uid-marek', { email: 'marek@example.test', displayName: 'Marek' });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      userDirectory: directory,
      caller: userCaller('uid-marek', []),
    });

    const result = await getMe({}, scope);

    expect(result.user.mustChangePassword).toBe(false);
  });

  it('projects mustChangePassword: true when the profile flag is set', async () => {
    const { InMemoryUserProfileRepository } = await import('@mediforce/platform-core/testing');
    const userProfileRepo = new InMemoryUserProfileRepository();
    await userProfileRepo.setMustChangePassword('uid-marek', true);
    const directory = directoryWith('uid-marek', { email: 'marek@example.test', displayName: 'Marek' });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      userProfileRepo,
      userDirectory: directory,
      caller: userCaller('uid-marek', []),
    });

    const result = await getMe({}, scope);

    expect(result.user.mustChangePassword).toBe(true);
  });

  it('projects hasPassword from the credentials port', async () => {
    const { InMemoryCredentialsRepository } = await import('@mediforce/platform-core/testing');
    const directory = directoryWith('uid-marek', { email: 'marek@example.test', displayName: 'Marek' });

    const withoutPassword = new InMemoryCredentialsRepository();
    const noneResult = await getMe(
      {},
      createTestScope({
        namespaceRepo,
        auditRepo,
        userDirectory: directory,
        credentialsRepo: withoutPassword,
        caller: userCaller('uid-marek', []),
      }),
    );
    expect(noneResult.user.hasPassword).toBe(false);

    const withPassword = new InMemoryCredentialsRepository();
    await withPassword.setPasswordHash('uid-marek', '$2b$04$notarealhashbutstoredallthesame');
    const setResult = await getMe(
      {},
      createTestScope({
        namespaceRepo,
        auditRepo,
        userDirectory: directory,
        credentialsRepo: withPassword,
        caller: userCaller('uid-marek', []),
      }),
    );
    expect(setResult.user.hasPassword).toBe(true);
  });
});
