import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAgentRunRepository,
  InMemoryProcessInstanceRepository,
  buildAgentRun,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { listAgentRuns } from '../list-agent-runs';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

describe('listAgentRuns handler', () => {
  let agentRunRepo: InMemoryAgentRunRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(async () => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    agentRunRepo = new InMemoryAgentRunRepository(instanceRepo);
    await instanceRepo.create(buildProcessInstance({ id: 'inst-alpha', namespace: 'team-alpha' }));
    await instanceRepo.create(buildProcessInstance({ id: 'inst-beta', namespace: 'team-beta' }));
    await agentRunRepo.create(
      buildAgentRun({ id: 'r-a', processInstanceId: 'inst-alpha', startedAt: '2026-05-28T12:00:00.000Z' }),
    );
    await agentRunRepo.create(
      buildAgentRun({ id: 'r-b', processInstanceId: 'inst-beta', startedAt: '2026-05-28T11:00:00.000Z' }),
    );
  });

  it('returns every run for an apiKey caller, newest first', async () => {
    const scope = createTestScope({ agentRunRepo, instanceRepo });
    const result = await listAgentRuns({ limit: 50 }, scope);
    expect(result.runs.map((r) => r.id)).toEqual(['r-a', 'r-b']);
    expect(result.nextCursor).toBeUndefined();
  });

  // #588 flip: agent-runs now lands on Postgres with a denormalised
  // `workspace` column, so `scope.agentRuns.listPage` (used here instead of
  // the still-ungated legacy `list`) restores real per-row workspace
  // gating — a user caller only sees runs in their own namespaces.
  it('returns only runs in the user caller\'s namespaces', async () => {
    const scope = createTestScope({
      agentRunRepo,
      instanceRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    const result = await listAgentRuns({ limit: 50 }, scope);
    expect(result.runs.map((r) => r.id)).toEqual(['r-a']);
  });

  it('explicit ?namespace= for a workspace outside the caller\'s allowed set returns empty (anti-enumeration)', async () => {
    const scope = createTestScope({
      agentRunRepo,
      instanceRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    const result = await listAgentRuns({ limit: 50, namespace: 'team-beta' }, scope);
    expect(result.runs).toEqual([]);
  });

  it('emits a stable nextCursor when limit < total visible runs', async () => {
    const scope = createTestScope({ agentRunRepo, instanceRepo });
    const first = await listAgentRuns({ limit: 1 }, scope);
    expect(first.runs.map((r) => r.id)).toEqual(['r-a']);
    expect(first.nextCursor).toBeDefined();

    const second = await listAgentRuns({ limit: 1, cursor: first.nextCursor }, scope);
    expect(second.runs.map((r) => r.id)).toEqual(['r-b']);
    expect(second.nextCursor).toBeUndefined();
  });
});
