/**
 * Firestore-level regression guard for `FirestoreHumanTaskRepository`.
 * Locks in the 30-value `in`-operator chunking on `getByInstanceIdsAll`
 * — a silent regression to a single oversized `in` would throw at
 * runtime on workspaces with more than 30 active runs.
 */
import { describe, it, expect, vi } from 'vitest';
import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import { InMemoryProcessInstanceRepository } from '@mediforce/platform-core/testing';
import { FirestoreHumanTaskRepository } from '../firestore/human-task-repository';

interface InCall {
  readonly field: string;
  readonly op: string;
  readonly values: readonly string[];
}

interface MockCollection {
  readonly calls: InCall[];
  readonly query: Record<string, unknown>;
}

function buildCollection(
  docsByChunk: ReadonlyArray<ReadonlyArray<Record<string, unknown>>>,
): MockCollection {
  const calls: InCall[] = [];
  const query: Record<string, unknown> = {};
  query.where = vi.fn((field: unknown, op: string, value: unknown) => {
    if (op === 'in' && Array.isArray(value)) {
      const label =
        typeof field === 'string'
          ? field
          : field instanceof FieldPath
            ? '__name__'
            : 'unknown';
      calls.push({ field: label, op, values: [...(value as string[])] });
    }
    return query;
  });
  query.get = vi.fn(async () => {
    const idx = (query.get as { _callIdx?: number })._callIdx ?? 0;
    (query.get as { _callIdx?: number })._callIdx = idx + 1;
    const docs = docsByChunk[idx] ?? [];
    return { docs: docs.map((d) => ({ id: String(d.id ?? 'x'), data: () => d })) };
  });
  return { calls, query };
}

function makeDb(
  docsByChunk: ReadonlyArray<ReadonlyArray<Record<string, unknown>>> = [],
  parentDocsByChunk: ReadonlyArray<ReadonlyArray<Record<string, unknown>>> = [],
): {
  db: Firestore;
  calls: InCall[];
  parentCalls: InCall[];
} {
  const tasks = buildCollection(docsByChunk);
  const parents = buildCollection(parentDocsByChunk);
  const db = {
    collection: vi.fn((name: string) => {
      if (name === 'humanTasks') return tasks.query;
      if (name === 'processInstances') return parents.query;
      throw new Error(`unexpected: ${name}`);
    }),
  } as unknown as Firestore;
  return { db, calls: tasks.calls, parentCalls: parents.calls };
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

  it('returns raw doc data without schema parse so legacy corrupt tasks do not 400 the page', async () => {
    const corrupt = {
      id: 'task-legacy',
      processInstanceId: 'inst-0000',
      assignedRole: 'reviewer',
      assignedUserId: null,
      status: 'cancelled',
      createdAt: '2026-01-15T10:00:00.000Z',
      updatedAt: { _seconds: 1, _nanoseconds: 0 },
      completedAt: null,
      completionData: {},
      deleted: false,
    };
    const { db } = makeDb([[corrupt]]);
    const parents = new InMemoryProcessInstanceRepository();
    const repo = new FirestoreHumanTaskRepository(db, parents);

    const result = await repo.getByInstanceIdsAll(['inst-0000']);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('task-legacy');
    expect(result[0].status).toBe('cancelled');
  });
});

describe('FirestoreHumanTaskRepository.getByInstanceIdsInNamespaces', () => {
  it('returns [] without touching Firestore when given an empty input', async () => {
    const { db, calls, parentCalls } = makeDb();
    const parents = new InMemoryProcessInstanceRepository();
    const repo = new FirestoreHumanTaskRepository(db, parents);

    const result = await repo.getByInstanceIdsInNamespaces([], ['ns-a']);

    expect(result).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(parentCalls).toHaveLength(0);
  });

  it('chunks 31 ids into 30 + 1 parent-ns lookups via __name__', async () => {
    const allIds = ids(31);
    const parentDocs = allIds.map((id) => ({ id, namespace: 'ns-a' }));
    const { db, calls, parentCalls } = makeDb(
      [allIds.map((id) => ({ id: `task-${id}`, processInstanceId: id }))],
      [parentDocs.slice(0, 30), parentDocs.slice(30)],
    );
    const parents = new InMemoryProcessInstanceRepository();
    const repo = new FirestoreHumanTaskRepository(db, parents);

    await repo.getByInstanceIdsInNamespaces(allIds, ['ns-a']);

    expect(parentCalls).toHaveLength(2);
    expect(parentCalls[0].field).toBe('__name__');
    expect(parentCalls[0].values).toHaveLength(30);
    expect(parentCalls[1].values).toHaveLength(1);
    expect(calls.map((c) => c.values.length)).toEqual([30, 1]);
  });

  it('chunks 322 ids into 11 parent-ns lookups [30×10, 22]', async () => {
    const allIds = ids(322);
    const parentDocs = allIds.map((id) => ({ id, namespace: 'ns-a' }));
    const parentChunks: Record<string, unknown>[][] = [];
    for (let i = 0; i < parentDocs.length; i += 30) {
      parentChunks.push(parentDocs.slice(i, i + 30));
    }
    const taskChunks: Record<string, unknown>[][] = [];
    for (let i = 0; i < allIds.length; i += 30) {
      taskChunks.push(
        allIds.slice(i, i + 30).map((id) => ({ id: `task-${id}`, processInstanceId: id })),
      );
    }
    const { db, calls, parentCalls } = makeDb(taskChunks, parentChunks);
    const parents = new InMemoryProcessInstanceRepository();
    const repo = new FirestoreHumanTaskRepository(db, parents);

    await repo.getByInstanceIdsInNamespaces(allIds, ['ns-a']);

    expect(parentCalls.map((c) => c.values.length)).toEqual([
      30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 22,
    ]);
    expect(calls.map((c) => c.values.length)).toEqual([
      30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 22,
    ]);
  });

  it('drops ids whose parent namespace is not in allowed before fetching tasks', async () => {
    const allIds = ids(4);
    const parentDocs = [
      { id: allIds[0], namespace: 'ns-a' },
      { id: allIds[1], namespace: 'ns-b' },
      { id: allIds[2], namespace: 'ns-a' },
      // allIds[3] missing — orphan parent doc
    ];
    const { db, calls, parentCalls } = makeDb(
      [
        [
          { id: 'task-0', processInstanceId: allIds[0] },
          { id: 'task-2', processInstanceId: allIds[2] },
        ],
      ],
      [parentDocs],
    );
    const parents = new InMemoryProcessInstanceRepository();
    const repo = new FirestoreHumanTaskRepository(db, parents);

    const result = await repo.getByInstanceIdsInNamespaces(allIds, ['ns-a']);

    expect(parentCalls).toHaveLength(1);
    expect(parentCalls[0].values).toEqual(allIds);
    expect(calls).toHaveLength(1);
    expect(calls[0].values).toEqual([allIds[0], allIds[2]]);
    expect(result.map((t) => t.id)).toEqual(['task-0', 'task-2']);
  });

});
