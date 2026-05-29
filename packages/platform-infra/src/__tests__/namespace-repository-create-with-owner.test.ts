import { describe, it, expect, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import type { Namespace, NamespaceMember } from '@mediforce/platform-core';
import { FirestoreNamespaceRepository } from '../firestore/namespace-repository';

interface BatchSpy {
  sets: Array<{ refId: string; data: unknown; options?: unknown }>;
  commitCalled: boolean;
  commitErr: Error | null;
}

function makeBatchDb(opts: { commitErr?: Error } = {}): {
  db: Firestore;
  spy: BatchSpy;
} {
  const spy: BatchSpy = { sets: [], commitCalled: false, commitErr: opts.commitErr ?? null };

  function makeRef(refId: string): unknown {
    return {
      id: refId,
      collection: (sub: string) => ({
        doc: (childId: string) => makeRef(`${refId}/${sub}/${childId}`),
      }),
    };
  }

  const batch = {
    set: (ref: { id: string }, data: unknown, options?: unknown) => {
      spy.sets.push({ refId: ref.id, data, options });
    },
    commit: async () => {
      spy.commitCalled = true;
      if (spy.commitErr !== null) throw spy.commitErr;
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

const NAMESPACE: Namespace = {
  handle: 'acme',
  type: 'organization',
  displayName: 'Acme Co.',
  createdAt: '2026-05-28T00:00:00.000Z',
};

const OWNER: NamespaceMember = {
  uid: 'uid-owner',
  role: 'owner',
  joinedAt: '2026-05-28T00:00:00.000Z',
};

describe('FirestoreNamespaceRepository.createNamespaceWithOwner', () => {
  it('writes namespace doc + owner member doc + denormalised users.organizations in one batch', async () => {
    const { db, spy } = makeBatchDb();
    const repo = new FirestoreNamespaceRepository(db);

    await repo.createNamespaceWithOwner({ namespace: NAMESPACE, ownerMember: OWNER });

    expect(spy.commitCalled).toBe(true);
    expect(spy.sets).toHaveLength(3);

    const [namespaceWrite, memberWrite, userWrite] = spy.sets;
    expect(namespaceWrite?.refId).toBe('namespaces/acme');
    expect(namespaceWrite?.data).toEqual(NAMESPACE);

    expect(memberWrite?.refId).toBe('namespaces/acme/members/uid-owner');
    expect(memberWrite?.data).toEqual(OWNER);

    expect(userWrite?.refId).toBe('users/uid-owner');
    expect(userWrite?.options).toEqual({ merge: true });
    expect(userWrite?.data).toMatchObject({ organizations: expect.anything() });
  });

  it('rejects when commit fails; caller observes the underlying error', async () => {
    const boom = new Error('write conflict');
    const { db, spy } = makeBatchDb({ commitErr: boom });
    const repo = new FirestoreNamespaceRepository(db);

    await expect(
      repo.createNamespaceWithOwner({ namespace: NAMESPACE, ownerMember: OWNER }),
    ).rejects.toBe(boom);
    expect(spy.commitCalled).toBe(true);
    expect(spy.sets).toHaveLength(3);
  });

  it('does not write to the per-doc collection paths outside the batch', async () => {
    const { db } = makeBatchDb();
    const collectionSpy = vi.spyOn(db, 'collection');
    const repo = new FirestoreNamespaceRepository(db);

    await repo.createNamespaceWithOwner({ namespace: NAMESPACE, ownerMember: OWNER });

    expect(collectionSpy).toHaveBeenCalledWith('namespaces');
    expect(collectionSpy).toHaveBeenCalledWith('users');
  });
});
