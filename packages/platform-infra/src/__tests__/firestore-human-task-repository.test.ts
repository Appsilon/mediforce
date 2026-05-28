/**
 * Firestore-level regression guard for `FirestoreHumanTaskRepository`.
 * Locks in the 30-value `in`-operator chunking on `getByInstanceIdsAll`
 * — a silent regression to a single oversized `in` would throw at
 * runtime on workspaces with more than 30 active runs.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { InMemoryProcessInstanceRepository } from '@mediforce/platform-core/testing';
import { FirestoreHumanTaskRepository } from '../firestore/human-task-repository.js';

interface InCall {
  readonly field: string;
  readonly op: string;
  readonly values: readonly string[];
}

function makeDb(): { db: Firestore; calls: InCall[] } {
  const calls: InCall[] = [];
  const query: Record<string, unknown> = {};
  query.where = vi.fn((field: string, op: string, value: unknown) => {
    if (op === 'in' && Array.isArray(value)) {
      calls.push({ field, op, values: [...(value as string[])] });
    }
    return query;
  });
  query.get = vi.fn(async () => ({ docs: [] }));
  const db = {
    collection: vi.fn((name: string) => {
      if (name !== 'humanTasks') throw new Error(`unexpected: ${name}`);
      return query;
    }),
  } as unknown as Firestore;
  return { db, calls };
}

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `inst-${i.toString().padStart(4, '0')}`);
}

describe('FirestoreHumanTaskRepository.getByInstanceIdsAll', () => {
  it('returns [] without touching Firestore when given an empty input', async () => {
    const { db, calls } = makeDb();
    const parents = new InMemoryProcessInstanceRepository();
    const repo = new FirestoreHumanTaskRepository(db, parents);

    const result = await repo.getByInstanceIdsAll([]);

    expect(result).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('fits 30 ids in a single chunk', async () => {
    const { db, calls } = makeDb();
    const parents = new InMemoryProcessInstanceRepository();
    const repo = new FirestoreHumanTaskRepository(db, parents);

    await repo.getByInstanceIdsAll(ids(30));

    expect(calls).toHaveLength(1);
    expect(calls[0].field).toBe('processInstanceId');
    expect(calls[0].values).toHaveLength(30);
  });

  it('splits 31 ids into 30 + 1', async () => {
    const { db, calls } = makeDb();
    const parents = new InMemoryProcessInstanceRepository();
    const repo = new FirestoreHumanTaskRepository(db, parents);

    await repo.getByInstanceIdsAll(ids(31));

    expect(calls).toHaveLength(2);
    expect(calls[0].values).toHaveLength(30);
    expect(calls[1].values).toHaveLength(1);
  });

  it('splits 60 ids into 30 + 30 with no overlap', async () => {
    const { db, calls } = makeDb();
    const parents = new InMemoryProcessInstanceRepository();
    const repo = new FirestoreHumanTaskRepository(db, parents);

    const all = ids(60);
    await repo.getByInstanceIdsAll(all);

    expect(calls).toHaveLength(2);
    expect(calls[0].values).toHaveLength(30);
    expect(calls[1].values).toHaveLength(30);
    const seen = new Set([...calls[0].values, ...calls[1].values]);
    expect(seen.size).toBe(60);
    expect([...seen].sort()).toEqual([...all].sort());
  });

  it('splits 113 ids into 30 + 30 + 30 + 23', async () => {
    const { db, calls } = makeDb();
    const parents = new InMemoryProcessInstanceRepository();
    const repo = new FirestoreHumanTaskRepository(db, parents);

    await repo.getByInstanceIdsAll(ids(113));

    expect(calls.map((c) => c.values.length)).toEqual([30, 30, 30, 23]);
  });
});
