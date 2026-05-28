import { describe, it, expect } from 'vitest';
import {
  InMemoryAgentRunRepository,
  InMemoryProcessInstanceRepository,
  buildAgentRun,
  buildProcessInstance,
  encodeAgentRunCursor,
  decodeAgentRunCursor,
} from '../index.js';

describe('encodeAgentRunCursor / decodeAgentRunCursor', () => {
  it('round-trips a startedAt + id pair', () => {
    const cursor = encodeAgentRunCursor('2026-05-28T10:00:00.000Z', 'ar-1');
    expect(decodeAgentRunCursor(cursor)).toEqual({
      startedAt: '2026-05-28T10:00:00.000Z',
      id: 'ar-1',
    });
  });

  it('returns null on malformed tokens', () => {
    // 'Zm9v' is base64url('foo') — round-trips through base64 but
    // JSON.parse throws, so the codec surfaces null rather than crashing.
    expect(decodeAgentRunCursor('Zm9v')).toBeNull();
    expect(decodeAgentRunCursor('')).toBeNull();
    // Payload that parses as JSON but fails the keyset schema (missing
    // `id`) — schema validation guards against shape drift across
    // backends or future codec changes.
    const wrongShape = Buffer.from(JSON.stringify({ startedAt: 'x' }), 'utf8').toString('base64url');
    expect(decodeAgentRunCursor(wrongShape)).toBeNull();
  });
});

describe('InMemoryAgentRunRepository.list', () => {
  it('returns runs ordered by startedAt desc with id tie-break', async () => {
    const repo = new InMemoryAgentRunRepository();
    await repo.create(buildAgentRun({ id: 'a', startedAt: '2026-05-28T10:00:00.000Z' }));
    await repo.create(buildAgentRun({ id: 'b', startedAt: '2026-05-28T12:00:00.000Z' }));
    await repo.create(buildAgentRun({ id: 'c', startedAt: '2026-05-28T12:00:00.000Z' }));

    const page = await repo.list({ limit: 10 });
    // 12:00 first; among the tie, 'c' > 'b' lexicographically so 'c' wins.
    expect(page.items.map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(page.nextCursor).toBeUndefined();
  });

  it('paginates stably across a cursor boundary', async () => {
    const repo = new InMemoryAgentRunRepository();
    for (let i = 0; i < 5; i++) {
      await repo.create(
        buildAgentRun({
          id: `ar-${String(i)}`,
          startedAt: `2026-05-28T10:0${String(i)}:00.000Z`,
        }),
      );
    }

    const first = await repo.list({ limit: 2 });
    expect(first.items.map((r) => r.id)).toEqual(['ar-4', 'ar-3']);
    expect(first.nextCursor).toBeDefined();

    const second = await repo.list({ limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((r) => r.id)).toEqual(['ar-2', 'ar-1']);
    expect(second.nextCursor).toBeDefined();

    const third = await repo.list({ limit: 2, cursor: second.nextCursor! });
    expect(third.items.map((r) => r.id)).toEqual(['ar-0']);
    expect(third.nextCursor).toBeUndefined();
  });

  it('filters by runId + stepId', async () => {
    const repo = new InMemoryAgentRunRepository();
    await repo.create(buildAgentRun({ id: 'm1', processInstanceId: 'inst-a', stepId: 'review' }));
    await repo.create(buildAgentRun({ id: 'm2', processInstanceId: 'inst-a', stepId: 'approve' }));
    await repo.create(buildAgentRun({ id: 'm3', processInstanceId: 'inst-b', stepId: 'review' }));

    const result = await repo.list({ limit: 10, runId: 'inst-a', stepId: 'review' });
    expect(result.items.map((r) => r.id)).toEqual(['m1']);
  });
});

describe('InMemoryAgentRunRepository.listInNamespaces', () => {
  it('only returns runs whose parent instance lives in `allowed`', async () => {
    const parents = new InMemoryProcessInstanceRepository();
    await parents.create(buildProcessInstance({ id: 'inst-alpha', namespace: 'team-alpha' }));
    await parents.create(buildProcessInstance({ id: 'inst-beta', namespace: 'team-beta' }));
    await parents.create(buildProcessInstance({ id: 'inst-orphan', namespace: undefined }));

    const repo = new InMemoryAgentRunRepository(parents);
    await repo.create(buildAgentRun({ id: 'r-a', processInstanceId: 'inst-alpha' }));
    await repo.create(buildAgentRun({ id: 'r-b', processInstanceId: 'inst-beta' }));
    await repo.create(buildAgentRun({ id: 'r-o', processInstanceId: 'inst-orphan' }));

    const result = await repo.listInNamespaces(['team-alpha'], { limit: 10 });
    expect(result.items.map((r) => r.id)).toEqual(['r-a']);
  });

  it('throws when called without a parent repo', async () => {
    const repo = new InMemoryAgentRunRepository();
    await expect(repo.listInNamespaces(['team-x'], { limit: 10 })).rejects.toThrow(
      /ProcessInstanceRepository required/,
    );
  });
});
