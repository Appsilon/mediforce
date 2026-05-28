import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAgentRunRepository,
  InMemoryProcessInstanceRepository,
  buildAgentRun,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { listAgentRuns } from '../list-agent-runs.js';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope.js';

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

  it('scopes a user caller to their workspaces', async () => {
    const scope = createTestScope({
      agentRunRepo,
      instanceRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    const result = await listAgentRuns({ limit: 50 }, scope);
    expect(result.runs.map((r) => r.id)).toEqual(['r-a']);
  });

  it('returns a 403 when the user explicitly asks for a non-member workspace', async () => {
    const scope = createTestScope({
      agentRunRepo,
      instanceRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    await expect(
      listAgentRuns({ limit: 50, namespace: 'team-beta' }, scope),
    ).rejects.toThrow(/Not a member/);
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
