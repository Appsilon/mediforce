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

  // PR2 parity with the pre-PR2 Firestore subscription (`useCollection`)
  // intentionally drops the per-row workspace gate — both system and user
  // callers see the full list. Real gating returns once agent-runs lands
  // on Postgres with a denormalised `namespace` column (#588), and these
  // assertions flip back at that point.
  it('returns every run for a user caller too (no workspace gating, see #588)', async () => {
    const scope = createTestScope({
      agentRunRepo,
      instanceRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    const result = await listAgentRuns({ limit: 50 }, scope);
    expect(result.runs.map((r) => r.id)).toEqual(['r-a', 'r-b']);
  });

  it('explicit ?namespace= is also a no-op until #588 (no 403, full list)', async () => {
    const scope = createTestScope({
      agentRunRepo,
      instanceRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    const result = await listAgentRuns({ limit: 50, namespace: 'team-beta' }, scope);
    expect(result.runs.map((r) => r.id)).toEqual(['r-a', 'r-b']);
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
