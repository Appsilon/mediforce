import { describe, it, expect } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { FirestoreNamespaceRepository } from '../firestore/namespace-repository';

interface BatchSpy {
  ops: Array<{ op: 'set' | 'delete'; refId: string; data?: unknown; options?: unknown }>;
  commitCalled: boolean;
}

function makeBatchDb(memberDocs: Array<{ id: string }>): { db: Firestore; spy: BatchSpy } {
  const spy: BatchSpy = { ops: [], commitCalled: false };

  function makeRef(refId: string): unknown {
    return {
      id: refId,
      collection: (sub: string) => ({
        doc: (childId: string) => makeRef(`${refId}/${sub}/${childId}`),
        async get() {
          return {
            docs: memberDocs.map((d) => ({
              id: d.id,
              ref: makeRef(`${refId}/${sub}/${d.id}`),
            })),
          };
        },
      }),
    };
  }

  const batch = {
    set: (ref: { id: string }, data: unknown, options?: unknown) => {
      spy.ops.push({ op: 'set', refId: ref.id, data, options });
    },
    delete: (ref: { id: string }) => {
      spy.ops.push({ op: 'delete', refId: ref.id });
    },
    commit: async () => {
      spy.commitCalled = true;
    },
  };

  const db = {
    batch: () => batch,
    collection: (name: string) => ({
      doc: (id: string) => makeRef(`${name}/${id}`),
    }),
  } as unknown as Firestore;

  return { db, spy };
}

describe('FirestoreNamespaceRepository.deleteNamespaceCascade', () => {
  it('deletes every member doc, arrayRemoves organizations per member, then deletes the namespace', async () => {
    const { db, spy } = makeBatchDb([{ id: 'uid-owner' }, { id: 'uid-member-a' }, { id: 'uid-member-b' }]);
    const repo = new FirestoreNamespaceRepository(db);

    await repo.deleteNamespaceCascade('acme');

    expect(spy.commitCalled).toBe(true);
    // 2 ops per member (delete subdoc + arrayRemove on users/{uid}) + 1 namespace delete.
    expect(spy.ops).toHaveLength(7);

    const memberDeletes = spy.ops.filter((o) => o.op === 'delete' && o.refId.startsWith('namespaces/acme/members/'));
    expect(memberDeletes.map((o) => o.refId)).toEqual([
      'namespaces/acme/members/uid-owner',
      'namespaces/acme/members/uid-member-a',
      'namespaces/acme/members/uid-member-b',
    ]);

    const orgRemoves = spy.ops.filter((o) => o.op === 'set' && o.refId.startsWith('users/'));
    expect(orgRemoves.map((o) => o.refId)).toEqual([
      'users/uid-owner',
      'users/uid-member-a',
      'users/uid-member-b',
    ]);
    for (const op of orgRemoves) {
      expect(op.options).toEqual({ merge: true });
      expect(op.data).toMatchObject({ organizations: expect.anything() });
    }

    const namespaceDelete = spy.ops.find(
      (o) => o.op === 'delete' && o.refId === 'namespaces/acme',
    );
    expect(namespaceDelete).toBeDefined();
  });

  it('an empty workspace still writes the single namespace delete', async () => {
    const { db, spy } = makeBatchDb([]);
    const repo = new FirestoreNamespaceRepository(db);

    await repo.deleteNamespaceCascade('empty');

    expect(spy.commitCalled).toBe(true);
    expect(spy.ops).toEqual([{ op: 'delete', refId: 'namespaces/empty' }]);
  });
});

describe('FirestoreNamespaceRepository.removeMemberWithOrganizations', () => {
  it('atomically deletes the member doc and arrayRemoves from users/{uid}.organizations', async () => {
    const { db, spy } = makeBatchDb([]);
    const repo = new FirestoreNamespaceRepository(db);

    await repo.removeMemberWithOrganizations('acme', 'uid-member');

    expect(spy.commitCalled).toBe(true);
    expect(spy.ops).toHaveLength(2);
    expect(spy.ops[0]).toMatchObject({ op: 'delete', refId: 'namespaces/acme/members/uid-member' });
    expect(spy.ops[1]).toMatchObject({
      op: 'set',
      refId: 'users/uid-member',
      options: { merge: true },
    });
    expect(spy.ops[1]?.data).toMatchObject({ organizations: expect.anything() });
  });
});
