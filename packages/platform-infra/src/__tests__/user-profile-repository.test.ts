import { describe, it, expect } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { FirestoreUserProfileRepository } from '../firestore/user-profile-repository';

interface DocSpy {
  exists: boolean;
  data?: Record<string, unknown>;
  sets: Array<{ data: unknown; options?: unknown }>;
}

function makeDb(opts: { docs?: Record<string, { exists: boolean; data?: Record<string, unknown> }> } = {}): {
  db: Firestore;
  spies: Map<string, DocSpy>;
} {
  const spies = new Map<string, DocSpy>();

  function makeDocRef(id: string): unknown {
    const seed = opts.docs?.[id];
    const spy: DocSpy = {
      exists: seed?.exists ?? false,
      data: seed?.data,
      sets: [],
    };
    spies.set(id, spy);
    return {
      async get() {
        return {
          exists: spy.exists,
          data: () => spy.data,
        };
      },
      async set(data: unknown, options?: unknown) {
        spy.sets.push({ data, options });
        spy.exists = true;
        spy.data = { ...(spy.data ?? {}), ...(data as Record<string, unknown>) };
      },
    };
  }

  const db = {
    collection: (name: string) => ({
      doc: (id: string) => makeDocRef(`${name}/${id}`),
    }),
  } as unknown as Firestore;

  return { db, spies };
}

describe('FirestoreUserProfileRepository', () => {
  it('returns null when no users/{uid} doc exists', async () => {
    const { db } = makeDb();
    const repo = new FirestoreUserProfileRepository(db);

    expect(await repo.getProfile('uid-missing')).toBeNull();
  });

  it('returns mustChangePassword:false when the doc exists but the field is absent', async () => {
    const { db } = makeDb({ docs: { 'users/uid-marek': { exists: true, data: {} } } });
    const repo = new FirestoreUserProfileRepository(db);

    expect(await repo.getProfile('uid-marek')).toEqual({ mustChangePassword: false });
  });

  it('returns mustChangePassword:true when the field is explicitly true', async () => {
    const { db } = makeDb({ docs: { 'users/uid-marek': { exists: true, data: { mustChangePassword: true } } } });
    const repo = new FirestoreUserProfileRepository(db);

    expect(await repo.getProfile('uid-marek')).toEqual({ mustChangePassword: true });
  });

  it('coerces non-boolean / non-true field values to false', async () => {
    const { db } = makeDb({
      docs: { 'users/uid-marek': { exists: true, data: { mustChangePassword: 'truthy-string' } } },
    });
    const repo = new FirestoreUserProfileRepository(db);

    expect(await repo.getProfile('uid-marek')).toEqual({ mustChangePassword: false });
  });

  it('setMustChangePassword writes via merge so it does not overwrite other fields', async () => {
    const { db, spies } = makeDb({
      docs: { 'users/uid-marek': { exists: true, data: { organizations: ['acme'] } } },
    });
    const repo = new FirestoreUserProfileRepository(db);

    await repo.setMustChangePassword('uid-marek', false);

    const spy = spies.get('users/uid-marek');
    expect(spy?.sets).toHaveLength(1);
    expect(spy?.sets[0]?.data).toEqual({ mustChangePassword: false });
    expect(spy?.sets[0]?.options).toEqual({ merge: true });
    // Existing field survived because merge:true semantics in test fake mirrors Firestore.
    expect(spy?.data).toMatchObject({ organizations: ['acme'], mustChangePassword: false });
  });

  it('setMustChangePassword creates the doc when absent (merge:true)', async () => {
    const { db, spies } = makeDb();
    const repo = new FirestoreUserProfileRepository(db);

    await repo.setMustChangePassword('uid-new', true);

    const spy = spies.get('users/uid-new');
    expect(spy?.sets).toHaveLength(1);
    expect(spy?.sets[0]?.data).toEqual({ mustChangePassword: true });
    expect(spy?.sets[0]?.options).toEqual({ merge: true });
  });
});
