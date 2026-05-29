import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { FirestoreNamespaceRepository } from '../firestore/namespace-repository';

/**
 * Tests for the `users/{uid}.organizations` primary path on
 * `getMembershipsForUser`. Mirrors the pattern already used by
 * `getUserNamespaces`: the single-doc read avoids requiring a deployed
 * `members` collectionGroup index in dev/emulator environments.
 *
 * Bug it covers: when the index is missing, the old implementation silently
 * returned personal-only memberships, which made every admin-gated handler
 * (invite, resend-invite, tool-catalog, docker-images) return 403 to real
 * admins.
 */

interface MockMember {
  uid: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt?: string;
}

interface MockState {
  users: Map<string, { organizations?: string[] }>;
  namespaceMembers: Map<string, Map<string, MockMember>>;
  personalNamespaces: Map<string, { handle: string; type: string; displayName: string; createdAt: string; linkedUserId?: string }>;
  collectionGroupThrowsCode9: boolean;
  collectionGroupCalls: number;
}

function makeDb(state: MockState): Firestore {
  function namespaceDoc(handle: string): unknown {
    return {
      collection: (sub: string) => {
        if (sub !== 'members') throw new Error(`unexpected sub: ${sub}`);
        return {
          doc: (uid: string) => ({
            get: async () => {
              const member = state.namespaceMembers.get(handle)?.get(uid);
              return {
                exists: member !== undefined,
                data: () => (member === undefined
                  ? undefined
                  : { uid: member.uid, role: member.role, joinedAt: member.joinedAt ?? '2026-01-01T00:00:00.000Z' }),
              };
            },
          }),
        };
      },
      get: async () => {
        const ns = state.personalNamespaces.get(handle);
        return {
          exists: ns !== undefined,
          data: () => ns,
        };
      },
    };
  }

  function usersCollection(): unknown {
    return {
      doc: (uid: string) => ({
        get: async () => {
          const user = state.users.get(uid);
          return {
            exists: user !== undefined,
            data: () => user,
          };
        },
      }),
    };
  }

  function namespacesCollection(): unknown {
    return {
      doc: (handle: string) => namespaceDoc(handle),
      where: (_field: string, _op: string, value: string) => ({
        get: async () => ({
          docs: [...state.personalNamespaces.values()]
            .filter((ns) => ns.linkedUserId === value)
            .map((ns) => ({ data: () => ns })),
        }),
      }),
    };
  }

  return {
    collection: (name: string) => {
      if (name === 'users') return usersCollection();
      if (name === 'namespaces') return namespacesCollection();
      throw new Error(`unexpected collection: ${name}`);
    },
    collectionGroup: (name: string) => {
      if (name !== 'members') throw new Error(`unexpected collectionGroup: ${name}`);
      return {
        where: (_field: string, _op: string, uid: string) => ({
          get: async () => {
            state.collectionGroupCalls += 1;
            if (state.collectionGroupThrowsCode9) {
              const err = new Error('FAILED_PRECONDITION: index missing');
              (err as unknown as { code: number }).code = 9;
              throw err;
            }
            const docs: Array<{ ref: { parent: { parent: { id: string } } }; data: () => MockMember }> = [];
            for (const [handle, members] of state.namespaceMembers.entries()) {
              const member = members.get(uid);
              if (member !== undefined) {
                docs.push({
                  ref: { parent: { parent: { id: handle } } },
                  data: () => ({ ...member, joinedAt: member.joinedAt ?? '2026-01-01T00:00:00.000Z' }),
                });
              }
            }
            return { docs };
          },
        }),
      };
    },
  } as unknown as Firestore;
}

function emptyState(): MockState {
  return {
    users: new Map(),
    namespaceMembers: new Map(),
    personalNamespaces: new Map(),
    collectionGroupThrowsCode9: false,
    collectionGroupCalls: 0,
  };
}

describe('FirestoreNamespaceRepository.getMembershipsForUser', () => {
  const UID = 'uid-admin-1';
  let state: MockState;
  let repo: FirestoreNamespaceRepository;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    state = emptyState();
    repo = new FirestoreNamespaceRepository(makeDb(state));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('returns memberships via users/{uid}.organizations without hitting collectionGroup', async () => {
    state.users.set(UID, { organizations: ['appsilon'] });
    state.namespaceMembers.set(
      'appsilon',
      new Map([[UID, { uid: UID, role: 'admin' }]]),
    );

    const result = await repo.getMembershipsForUser(UID);

    expect(result).toEqual([{ handle: 'appsilon', role: 'admin' }]);
    expect(state.collectionGroupCalls).toBe(0);
  });

  it('returns admin memberships even when collectionGroup index is missing (gRPC code 9)', async () => {
    // The actual bug: dev emulator without deployed members index throws
    // FAILED_PRECONDITION. The user-doc path must satisfy admin-gated handlers.
    state.collectionGroupThrowsCode9 = true;
    state.users.set(UID, { organizations: ['appsilon'] });
    state.namespaceMembers.set(
      'appsilon',
      new Map([[UID, { uid: UID, role: 'admin' }]]),
    );

    const result = await repo.getMembershipsForUser(UID);

    expect(result).toEqual([{ handle: 'appsilon', role: 'admin' }]);
  });

  it('falls back to collectionGroup query when organizations array is empty', async () => {
    state.users.set(UID, { organizations: [] });
    state.namespaceMembers.set(
      'appsilon',
      new Map([[UID, { uid: UID, role: 'member' }]]),
    );

    const result = await repo.getMembershipsForUser(UID);

    expect(result).toEqual([{ handle: 'appsilon', role: 'member' }]);
    expect(state.collectionGroupCalls).toBe(1);
  });

  it('merges personal namespace ownership on top of org memberships', async () => {
    state.users.set(UID, { organizations: ['appsilon'] });
    state.namespaceMembers.set(
      'appsilon',
      new Map([[UID, { uid: UID, role: 'member' }]]),
    );
    state.personalNamespaces.set('user-alice', {
      handle: 'user-alice',
      type: 'personal',
      displayName: 'Alice',
      createdAt: '2026-01-01T00:00:00.000Z',
      linkedUserId: UID,
    });

    const result = await repo.getMembershipsForUser(UID);

    expect(result).toEqual(
      expect.arrayContaining([
        { handle: 'appsilon', role: 'member' },
        { handle: 'user-alice', role: 'owner' },
      ]),
    );
    expect(result).toHaveLength(2);
  });

  it('returns empty when no user doc, no organizations, and collectionGroup yields nothing', async () => {
    const result = await repo.getMembershipsForUser(UID);
    expect(result).toEqual([]);
    warnSpy.mockRestore();
  });
});
