/**
 * Firestore composite-index regression guard — every list query must issue a
 * single `orderBy('startedAt','desc')` and use a snapshot cursor.
 *
 * Locks down the composite-index avoidance in `fetchPage`: a previous
 * implementation chained `.orderBy('startedAt','desc').orderBy('id','desc')`
 * plus `startAfter(startedAt, id)`, which Firestore rejected at runtime with
 * `9 FAILED_PRECONDITION: The query requires an index`. The current impl
 * relies on Firestore's implicit `__name__` tie-break and a
 * `DocumentSnapshot`-based cursor. These tests fail loudly if someone
 * reintroduces the second `orderBy` or swaps the snapshot cursor back for a
 * primitive pair.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import {
  buildAgentRun,
  buildProcessInstance,
  InMemoryProcessInstanceRepository,
  encodeAgentRunCursor,
  decodeAgentRunCursor,
} from '@mediforce/platform-core/testing';
import type { AgentRun } from '@mediforce/platform-core';
import { FirestoreAgentRunRepository } from '../firestore/agent-run-repository.js';

interface OrderByCall {
  readonly field: string;
  readonly direction: string;
}
interface WhereCall {
  readonly field: string;
  readonly op: string;
  readonly value: unknown;
}

interface QueryRecorder {
  readonly orderBy: OrderByCall[];
  readonly where: WhereCall[];
  readonly startAfterArgs: unknown[][];
  readonly limits: number[];
  collectionCalls: number;
  docGets: string[];
}

function makeQuery(recorder: QueryRecorder, rows: AgentRun[]): unknown {
  const query: Record<string, unknown> = {};
  query.orderBy = vi.fn((field: string, direction: string) => {
    recorder.orderBy.push({ field, direction });
    return query;
  });
  query.where = vi.fn((field: string, op: string, value: unknown) => {
    recorder.where.push({ field, op, value });
    return query;
  });
  query.startAfter = vi.fn((...args: unknown[]) => {
    recorder.startAfterArgs.push(args);
    return query;
  });
  query.limit = vi.fn((n: number) => {
    recorder.limits.push(n);
    return query;
  });
  query.get = vi.fn(async () => ({
    docs: rows.map((run) => ({ id: run.id, data: () => run })),
  }));
  return query;
}

function makeDb(
  recorder: QueryRecorder,
  rows: AgentRun[],
  docStore: Map<string, AgentRun>,
): Firestore {
  return {
    collection: vi.fn((name: string) => {
      if (name !== 'agentRuns') {
        throw new Error(`unexpected collection: ${name}`);
      }
      recorder.collectionCalls += 1;
      const query = makeQuery(recorder, rows);
      return {
        ...(query as Record<string, unknown>),
        doc: (id: string) => ({
          get: async () => {
            recorder.docGets.push(id);
            const run = docStore.get(id);
            return {
              exists: run !== undefined,
              id,
              data: () => run,
            };
          },
        }),
      };
    }),
  } as unknown as Firestore;
}

function newRecorder(): QueryRecorder {
  return {
    orderBy: [],
    where: [],
    startAfterArgs: [],
    limits: [],
    collectionCalls: 0,
    docGets: [],
  };
}

describe('FirestoreAgentRunRepository — composite-index regression guard', () => {
  let recorder: QueryRecorder;
  let parents: InMemoryProcessInstanceRepository;
  let docStore: Map<string, AgentRun>;

  beforeEach(() => {
    recorder = newRecorder();
    parents = new InMemoryProcessInstanceRepository();
    docStore = new Map();
  });

  it('list issues exactly one orderBy(startedAt, desc) — no composite (startedAt, id) sort', async () => {
    const rows: AgentRun[] = [buildAgentRun({ id: 'run-a' })];
    const db = makeDb(recorder, rows, docStore);
    const repo = new FirestoreAgentRunRepository(db, parents);

    await repo.list({ limit: 10 });

    expect(recorder.orderBy).toEqual([{ field: 'startedAt', direction: 'desc' }]);
  });

  it('cursor resolves the doc by id and passes the snapshot into startAfter', async () => {
    const cursorRun = buildAgentRun({ id: 'run-cursor', startedAt: '2026-05-20T10:00:00.000Z' });
    docStore.set(cursorRun.id, cursorRun);
    const rows: AgentRun[] = [buildAgentRun({ id: 'run-next' })];
    const db = makeDb(recorder, rows, docStore);
    const repo = new FirestoreAgentRunRepository(db, parents);

    const cursor = encodeAgentRunCursor(cursorRun.startedAt, cursorRun.id);
    await repo.list({ limit: 5, cursor });

    expect(recorder.docGets).toContain(cursorRun.id);
    expect(recorder.startAfterArgs).toHaveLength(1);
    const passed = recorder.startAfterArgs[0];
    expect(passed).toHaveLength(1);
    const snap = passed[0] as { id: string; exists: boolean };
    expect(snap.id).toBe(cursorRun.id);
    expect(snap.exists).toBe(true);
  });

  it('skips startAfter when the cursor doc has been deleted', async () => {
    const rows: AgentRun[] = [buildAgentRun({ id: 'run-1' })];
    const db = makeDb(recorder, rows, docStore);
    const repo = new FirestoreAgentRunRepository(db, parents);

    const cursor = encodeAgentRunCursor('2026-05-20T10:00:00.000Z', 'missing-run');
    await repo.list({ limit: 5, cursor });

    expect(recorder.docGets).toContain('missing-run');
    expect(recorder.startAfterArgs).toHaveLength(0);
  });

  it('adds a where(processInstanceId, ==, runId) when runId is set', async () => {
    const db = makeDb(recorder, [], docStore);
    const repo = new FirestoreAgentRunRepository(db, parents);

    await repo.list({ limit: 5, runId: 'inst-42' });

    expect(recorder.where).toContainEqual({
      field: 'processInstanceId',
      op: '==',
      value: 'inst-42',
    });
  });

  it('adds a where(stepId, ==, stepId) when stepId is set', async () => {
    const db = makeDb(recorder, [], docStore);
    const repo = new FirestoreAgentRunRepository(db, parents);

    await repo.list({ limit: 5, stepId: 'step-analyze' });

    expect(recorder.where).toContainEqual({
      field: 'stepId',
      op: '==',
      value: 'step-analyze',
    });
  });

  it('list applies limit + 1 for over-fetch ("more pages" detection)', async () => {
    const db = makeDb(recorder, [], docStore);
    const repo = new FirestoreAgentRunRepository(db, parents);

    await repo.list({ limit: 3 });

    expect(recorder.limits).toEqual([4]);
  });

  it('listInNamespaces over-fetches by 2x (limit * 2 + 1 on the query)', async () => {
    const db = makeDb(recorder, [], docStore);
    const repo = new FirestoreAgentRunRepository(db, parents);

    await repo.listInNamespaces(['team-alpha'], { limit: 3 });

    expect(recorder.limits).toEqual([7]);
  });

  it('listInNamespaces returns only runs whose parent namespace is in allowed', async () => {
    const parentAlphaOne = buildProcessInstance({ id: 'inst-alpha-1', namespace: 'team-alpha' });
    const parentAlphaTwo = buildProcessInstance({ id: 'inst-alpha-2', namespace: 'team-alpha' });
    const parentBeta = buildProcessInstance({ id: 'inst-beta-1', namespace: 'team-beta' });
    await parents.create(parentAlphaOne);
    await parents.create(parentAlphaTwo);
    await parents.create(parentBeta);

    const runs: AgentRun[] = [
      buildAgentRun({ id: 'run-a1', processInstanceId: parentAlphaOne.id, startedAt: '2026-05-25T10:00:00.000Z' }),
      buildAgentRun({ id: 'run-b1', processInstanceId: parentBeta.id, startedAt: '2026-05-24T10:00:00.000Z' }),
      buildAgentRun({ id: 'run-a2', processInstanceId: parentAlphaTwo.id, startedAt: '2026-05-23T10:00:00.000Z' }),
      buildAgentRun({ id: 'run-orphan', processInstanceId: 'inst-missing', startedAt: '2026-05-22T10:00:00.000Z' }),
    ];
    const db = makeDb(recorder, runs, docStore);
    const repo = new FirestoreAgentRunRepository(db, parents);

    const page = await repo.listInNamespaces(['team-alpha'], { limit: 10 });

    const ids = page.items.map((r) => r.id);
    expect(ids).toEqual(['run-a1', 'run-a2']);
  });

  it('listInNamespaces short-circuits to an empty page when allowed is empty', async () => {
    const rows: AgentRun[] = [
      buildAgentRun({ id: 'run-a1', processInstanceId: 'inst-1' }),
    ];
    const db = makeDb(recorder, rows, docStore);
    const repo = new FirestoreAgentRunRepository(db, parents);

    const page = await repo.listInNamespaces([], { limit: 5 });

    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeUndefined();
  });

  it('sets nextCursor to the last item when more pages exist', async () => {
    const parent = buildProcessInstance({ id: 'inst-1', namespace: 'team-alpha' });
    await parents.create(parent);

    const runs: AgentRun[] = [
      buildAgentRun({ id: 'run-1', startedAt: '2026-05-25T10:00:00.000Z' }),
      buildAgentRun({ id: 'run-2', startedAt: '2026-05-24T10:00:00.000Z' }),
      buildAgentRun({ id: 'run-3', startedAt: '2026-05-23T10:00:00.000Z' }),
      buildAgentRun({ id: 'run-4', startedAt: '2026-05-22T10:00:00.000Z' }),
    ];
    const db = makeDb(recorder, runs, docStore);
    const repo = new FirestoreAgentRunRepository(db, parents);

    const page = await repo.list({ limit: 2 });

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor !== undefined).toBe(true);
    const decoded = decodeAgentRunCursor(page.nextCursor as string);
    expect(decoded).toEqual({ startedAt: runs[1].startedAt, id: runs[1].id });
  });

  it('omits nextCursor when the page is exhausted', async () => {
    const runs: AgentRun[] = [
      buildAgentRun({ id: 'run-1', startedAt: '2026-05-25T10:00:00.000Z' }),
      buildAgentRun({ id: 'run-2', startedAt: '2026-05-24T10:00:00.000Z' }),
    ];
    const db = makeDb(recorder, runs, docStore);
    const repo = new FirestoreAgentRunRepository(db, parents);

    const page = await repo.list({ limit: 10 });

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeUndefined();
  });
});
