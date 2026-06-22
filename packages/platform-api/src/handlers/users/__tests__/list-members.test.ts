import { describe, it, expect, beforeEach } from 'vitest';
import type { NamespaceMember, UserDirectoryService } from '@mediforce/platform-core';
import { InMemoryNamespaceRepo, createTestScope, userCaller } from '../../../testing/index';
import { listNamespaceMembers } from '../list-members';
import { NotFoundError } from '../../../errors';

const ALPHA_MEMBERS: NamespaceMember[] = [
  { uid: 'uid-owner', role: 'owner', displayName: 'Alpha Owner', joinedAt: '2026-01-01T00:00:00.000Z' },
  { uid: 'uid-member', role: 'member', joinedAt: '2026-02-01T00:00:00.000Z' },
];

function directoryWith(
  map: ReadonlyMap<
    string,
    {
      email: string | null;
      displayName?: string | null;
      lastSignInTime: string | null;
      photoURL?: string | null;
    } | null
  >,
): UserDirectoryService {
  return {
    async getUsersByRole() {
      return [];
    },
    async getUserMetadata(uid: string) {
      const entry = map.has(uid) ? (map.get(uid) ?? null) : null;
      if (entry === null) return null;
      return {
        displayName: entry.displayName ?? null,
        email: entry.email,
        lastSignInTime: entry.lastSignInTime,
        photoURL: entry.photoURL ?? null,
      };
    },
  };
}

describe('listNamespaceMembers handler', () => {
  let namespaceRepo: InMemoryNamespaceRepo;
  let directory: UserDirectoryService;

  beforeEach(() => {
    namespaceRepo = new InMemoryNamespaceRepo();
    for (const m of ALPHA_MEMBERS) namespaceRepo.seedMember('alpha', m);
    directory = directoryWith(
      new Map([
        ['uid-owner', { email: 'owner@alpha.test', lastSignInTime: '2026-05-01T10:00:00.000Z' }],
        ['uid-member', { email: 'member@alpha.test', lastSignInTime: null }],
      ]),
    );
  });

  it('returns full member list with auth metadata for an apiKey caller', async () => {
    const scope = createTestScope({ namespaceRepo, userDirectory: directory });

    const result = await listNamespaceMembers({ namespace: 'alpha' }, scope);

    expect(result.members).toHaveLength(2);
    expect(result.members[0]).toMatchObject({
      uid: 'uid-owner',
      role: 'owner',
      email: 'owner@alpha.test',
      lastSignInTime: '2026-05-01T10:00:00.000Z',
    });
    expect(result.members[1]).toMatchObject({
      uid: 'uid-member',
      role: 'member',
      email: 'member@alpha.test',
      lastSignInTime: null,
    });
  });

  it('returns the list for a plain member of the namespace', async () => {
    const scope = createTestScope({
      namespaceRepo,
      userDirectory: directory,
      caller: userCaller('uid-member', ['alpha']),
    });

    const result = await listNamespaceMembers({ namespace: 'alpha' }, scope);

    expect(result.members).toHaveLength(2);
  });

  it('returns the list for an owner of the namespace', async () => {
    const scope = createTestScope({
      namespaceRepo,
      userDirectory: directory,
      caller: userCaller('uid-owner', ['alpha'], new Map([['alpha', 'owner' as const]])),
    });

    const result = await listNamespaceMembers({ namespace: 'alpha' }, scope);

    expect(result.members.map((m) => m.uid)).toEqual(['uid-owner', 'uid-member']);
  });

  it('throws NotFoundError (anti-enum) when caller is not a namespace member', async () => {
    const scope = createTestScope({
      namespaceRepo,
      userDirectory: directory,
      caller: userCaller('uid-stranger', ['beta']),
    });

    await expect(listNamespaceMembers({ namespace: 'alpha' }, scope)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('coalesces a transient directory error per uid to null fields', async () => {
    const flaky: UserDirectoryService = {
      async getUsersByRole() {
        return [];
      },
      async getUserMetadata(uid: string) {
        if (uid === 'uid-member') throw new Error('boom');
        return { email: 'owner@alpha.test', displayName: null, lastSignInTime: null, photoURL: null };
      },
    };
    const scope = createTestScope({ namespaceRepo, userDirectory: flaky });

    const result = await listNamespaceMembers({ namespace: 'alpha' }, scope);

    expect(result.members).toHaveLength(2);
    expect(result.members[1]).toMatchObject({
      uid: 'uid-member',
      email: null,
      lastSignInTime: null,
    });
  });

  it('keeps the workspace-scoped displayName when the member doc has one', async () => {
    directory = directoryWith(
      new Map([['uid-owner', { email: 'owner@alpha.test', displayName: 'Auth Owner Name', lastSignInTime: null }]]),
    );
    const scope = createTestScope({ namespaceRepo, userDirectory: directory });

    const result = await listNamespaceMembers({ namespace: 'alpha' }, scope);

    // Member doc displayName ('Alpha Owner') wins over auth profile name.
    expect(result.members[0]?.displayName).toBe('Alpha Owner');
  });

  it('falls back to the Firebase Auth displayName when the member doc has none', async () => {
    directory = directoryWith(
      new Map([
        ['uid-owner', { email: null, lastSignInTime: null }],
        ['uid-member', { email: null, displayName: 'Auth Member Name', lastSignInTime: null }],
      ]),
    );
    const scope = createTestScope({ namespaceRepo, userDirectory: directory });

    const result = await listNamespaceMembers({ namespace: 'alpha' }, scope);

    expect(result.members[1]?.displayName).toBe('Auth Member Name');
  });

  it('returns null displayName when neither the member doc nor auth metadata has one', async () => {
    directory = directoryWith(
      new Map([
        ['uid-owner', { email: null, lastSignInTime: null }],
        ['uid-member', { email: null, lastSignInTime: null }],
      ]),
    );
    const scope = createTestScope({ namespaceRepo, userDirectory: directory });

    const result = await listNamespaceMembers({ namespace: 'alpha' }, scope);

    expect(result.members[1]?.uid).toBe('uid-member');
    expect(result.members[1]?.displayName).toBeNull();
  });

  it('returns null email/lastSignInTime per member when directory is unconfigured', async () => {
    const scope = createTestScope({ namespaceRepo, userDirectory: null });

    const result = await listNamespaceMembers({ namespace: 'alpha' }, scope);

    expect(result.members).toHaveLength(2);
    for (const member of result.members) {
      expect(member.email).toBeNull();
      expect(member.lastSignInTime).toBeNull();
    }
  });
});
