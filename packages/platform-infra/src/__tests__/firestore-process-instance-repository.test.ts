/**
 * Firestore-level regression guard for `FirestoreProcessInstanceRepository`.
 * Locks in the trust-the-raw-data behaviour of `listAll` introduced after a
 * single legacy doc with an out-of-enum `status` or non-string `updatedAt`
 * turned the monitoring summary endpoint into a 400 ZodError and surfaced
 * `0/0/0` to the UI.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { FirestoreProcessInstanceRepository } from '../firestore/process-instance-repository';

interface RecordedWhere {
  readonly field: string;
  readonly op: string;
  readonly value: unknown;
}

function makeDb(docs: ReadonlyArray<Record<string, unknown>>): {
  db: Firestore;
  where: RecordedWhere[];
  limits: number[];
} {
  const where: RecordedWhere[] = [];
  const limits: number[] = [];
  const query: Record<string, unknown> = {};
  query.where = vi.fn((field: string, op: string, value: unknown) => {
    where.push({ field, op, value });
    return query;
  });
  query.orderBy = vi.fn(() => query);
  query.limit = vi.fn((n: number) => {
    limits.push(n);
    return query;
  });
  query.get = vi.fn(async () => ({
    docs: docs.map((d) => ({ id: String(d.id ?? 'unknown'), data: () => d })),
  }));
  const db = {
    collection: vi.fn((name: string) => {
      if (name !== 'processInstances') throw new Error(`unexpected: ${name}`);
      return query;
    }),
  } as unknown as Firestore;
  return { db, where, limits };
}

describe('FirestoreProcessInstanceRepository.listAll', () => {
  it('returns raw doc data without schema parse so legacy corrupt rows do not 400 the page', async () => {
    const corrupt = {
      id: 'inst-legacy',
      definitionName: 'supply-chain-review',
      definitionVersion: '1.0.0',
      status: 'cancelled',
      currentStepId: null,
      variables: {},
      triggerType: 'manual',
      triggerPayload: {},
      createdAt: '2026-01-15T10:00:00.000Z',
      updatedAt: { _seconds: 1, _nanoseconds: 0 },
      createdBy: 'user-1',
      pauseReason: null,
      error: null,
      assignedRoles: [],
      deleted: false,
      archived: false,
      namespace: 'mediforce',
    };
    const { db } = makeDb([corrupt]);
    const repo = new FirestoreProcessInstanceRepository(db);

    const result = await repo.listAll({ limit: 100 });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('inst-legacy');
    expect(result[0].status).toBe('cancelled');
    expect(result[0].namespace).toBe('mediforce');
  });

  it('forwards definitionName + status filters and the configured limit', async () => {
    const { db, where, limits } = makeDb([]);
    const repo = new FirestoreProcessInstanceRepository(db);

    await repo.listAll({ definitionName: 'wf', status: 'running', limit: 42 });

    expect(where).toContainEqual({ field: 'deleted', op: '==', value: false });
    expect(where).toContainEqual({ field: 'definitionName', op: '==', value: 'wf' });
    expect(where).toContainEqual({ field: 'status', op: '==', value: 'running' });
    expect(limits).toEqual([42]);
  });

  it('pushes the namespace filter into Firestore so cross-workspace docs never reach the JS layer', async () => {
    const { db, where } = makeDb([]);
    const repo = new FirestoreProcessInstanceRepository(db);

    await repo.listAll({ namespace: 'mediforce', limit: 100 });

    expect(where).toContainEqual({ field: 'namespace', op: '==', value: 'mediforce' });
  });
});
