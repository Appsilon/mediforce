import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryAgentRunRepository,
  InMemoryProcessInstanceRepository,
  buildAgentRun,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { getAgentRunCardStatusCounts } from '../get-agent-run-card-status-counts';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

describe('getAgentRunCardStatusCounts handler', () => {
  let agentRunRepo: InMemoryAgentRunRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(async () => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    agentRunRepo = new InMemoryAgentRunRepository(instanceRepo);
    await instanceRepo.create(buildProcessInstance({ id: 'inst-1', namespace: 'team-alpha' }));
    await agentRunRepo.create(buildAgentRun({ id: 'r-running', processInstanceId: 'inst-1', status: 'running' }));
    await agentRunRepo.create(buildAgentRun({ id: 'r-completed', processInstanceId: 'inst-1', status: 'completed' }));
    await agentRunRepo.create(
      buildAgentRun({ id: 'r-escalated', processInstanceId: 'inst-1', status: 'escalated' }),
    );
    await agentRunRepo.create(
      buildAgentRun({
        id: 'r-error',
        processInstanceId: 'inst-1',
        status: 'paused',
        fallbackReason: 'error',
      }),
    );
    await agentRunRepo.create(
      buildAgentRun({ id: 'r-paused-no-bucket', processInstanceId: 'inst-1', status: 'paused' }),
    );
  });

  it('returns total + per-bucket counts, matching the table\'s own card predicates', async () => {
    const scope = createTestScope({ agentRunRepo, instanceRepo });
    const result = await getAgentRunCardStatusCounts({}, scope);

    expect(result.counts).toEqual({
      total: 5,
      running: 1,
      completed: 1,
      error: 1,
      flagged: 1,
    });
  });

  it('scopes to the user caller\'s namespaces', async () => {
    await instanceRepo.create(buildProcessInstance({ id: 'inst-2', namespace: 'team-beta' }));
    await agentRunRepo.create(buildAgentRun({ id: 'r-other-ns', processInstanceId: 'inst-2', status: 'running' }));

    const scope = createTestScope({ agentRunRepo, instanceRepo, caller: userCaller('u-1', ['team-alpha']) });
    const result = await getAgentRunCardStatusCounts({}, scope);

    expect(result.counts.total).toBe(5);
  });

  it('respects the status filter', async () => {
    const scope = createTestScope({ agentRunRepo, instanceRepo });
    const result = await getAgentRunCardStatusCounts({ status: 'running' }, scope);

    expect(result.counts.total).toBe(1);
    expect(result.counts.running).toBe(1);
  });
});
