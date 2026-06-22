import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryAgentEventRepository,
  InMemoryProcessInstanceRepository,
  buildAgentEvent,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { listAgentEvents } from '../list-agent-events';
import { NotFoundError } from '../../../errors';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

describe('listAgentEvents handler', () => {
  let agentEventRepo: InMemoryAgentEventRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(async () => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    agentEventRepo = new InMemoryAgentEventRepository(instanceRepo);
    await instanceRepo.create(buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha' }));
    // Seed two steps' worth of events out of sequence order to prove the
    // sort. Append `seq=1` before `seq=0` so insertion order can't accidentally
    // satisfy the assertion.
    await agentEventRepo.append(
      buildAgentEvent({
        id: 'evt-a1',
        processInstanceId: 'inst-a',
        stepId: 'step-1',
        sequence: 1,
        type: 'status',
        payload: 'thinking',
      }),
    );
    await agentEventRepo.append(
      buildAgentEvent({
        id: 'evt-a0',
        processInstanceId: 'inst-a',
        stepId: 'step-1',
        sequence: 0,
        type: 'start',
      }),
    );
    await agentEventRepo.append(
      buildAgentEvent({
        id: 'evt-a2',
        processInstanceId: 'inst-a',
        stepId: 'step-2',
        sequence: 0,
        type: 'start',
      }),
    );
  });

  it('returns every event for the instance (api-key)', async () => {
    const scope = createTestScope({ agentEventRepo, instanceRepo });
    const result = await listAgentEvents({ instanceId: 'inst-a' }, scope);
    expect(result.events).toHaveLength(3);
    const ids = result.events.map((e) => e.id).sort();
    expect(ids).toEqual(['evt-a0', 'evt-a1', 'evt-a2']);
  });

  it('returns events for one step sorted by sequence ASC', async () => {
    const scope = createTestScope({ agentEventRepo, instanceRepo });
    const result = await listAgentEvents({ instanceId: 'inst-a', stepId: 'step-1' }, scope);
    // step-1 was seeded with seq=1 first, then seq=0 — sort by sequence.
    expect(result.events.map((e) => e.sequence)).toEqual([0, 1]);
    expect(result.events.map((e) => e.id)).toEqual(['evt-a0', 'evt-a1']);
  });

  it('returns events for in-namespace user callers', async () => {
    const scope = createTestScope({
      agentEventRepo,
      instanceRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    const result = await listAgentEvents({ instanceId: 'inst-a' }, scope);
    expect(result.events).toHaveLength(3);
  });

  it('returns only events with sequence > afterSequence (incremental poll)', async () => {
    const scope = createTestScope({ agentEventRepo, instanceRepo });
    const result = await listAgentEvents({ instanceId: 'inst-a', afterSequence: 0 }, scope);
    // Seeded sequences across the instance: 1, 0, 0 → only seq=1 survives.
    expect(result.events.map((e) => e.sequence)).toEqual([1]);
    expect(result.events.map((e) => e.id)).toEqual(['evt-a1']);
  });

  it('returns the full log when afterSequence is absent', async () => {
    const scope = createTestScope({ agentEventRepo, instanceRepo });
    const result = await listAgentEvents({ instanceId: 'inst-a' }, scope);
    expect(result.events).toHaveLength(3);
  });

  it('scopes afterSequence to a single step', async () => {
    const scope = createTestScope({ agentEventRepo, instanceRepo });
    const result = await listAgentEvents({ instanceId: 'inst-a', stepId: 'step-1', afterSequence: 0 }, scope);
    // step-1 holds seq 0 and 1; cursor at 0 leaves only seq=1.
    expect(result.events.map((e) => e.id)).toEqual(['evt-a1']);
  });

  it('returns an empty delta when afterSequence is past the latest event', async () => {
    const scope = createTestScope({ agentEventRepo, instanceRepo });
    const result = await listAgentEvents({ instanceId: 'inst-a', afterSequence: 99 }, scope);
    expect(result.events).toEqual([]);
  });

  it('returns only in-namespace deltas for user callers', async () => {
    const scope = createTestScope({
      agentEventRepo,
      instanceRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    const result = await listAgentEvents({ instanceId: 'inst-a', afterSequence: 0 }, scope);
    expect(result.events.map((e) => e.id)).toEqual(['evt-a1']);
  });

  it('throws NotFoundError when the instance does not exist', async () => {
    const scope = createTestScope({ agentEventRepo, instanceRepo });
    await expect(listAgentEvents({ instanceId: 'inst-missing' }, scope)).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError (not ForbiddenError) for cross-namespace user callers (anti-enumeration)', async () => {
    const scope = createTestScope({
      agentEventRepo,
      instanceRepo,
      caller: userCaller('u-2', ['team-beta']),
    });
    await expect(listAgentEvents({ instanceId: 'inst-a' }, scope)).rejects.toThrow(NotFoundError);
  });
});
