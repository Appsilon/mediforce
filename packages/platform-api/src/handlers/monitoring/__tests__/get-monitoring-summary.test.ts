import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryHumanTaskRepository,
  InMemoryProcessInstanceRepository,
  buildHumanTask,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { getMonitoringSummary } from '../get-monitoring-summary';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

describe('getMonitoringSummary handler', () => {
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(() => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    humanTaskRepo = new InMemoryHumanTaskRepository(instanceRepo);
  });

  it('aggregates runs and tasks scoped to a single workspace', async () => {
    await instanceRepo.create(buildProcessInstance({ id: 'inst-1', namespace: 'team-alpha', status: 'running' }));
    await instanceRepo.create(buildProcessInstance({ id: 'inst-2', namespace: 'team-alpha', status: 'paused' }));
    await instanceRepo.create(buildProcessInstance({ id: 'inst-3', namespace: 'team-beta', status: 'running' }));
    await humanTaskRepo.create(
      buildHumanTask({ id: 't1', processInstanceId: 'inst-1', assignedRole: 'reviewer', status: 'pending' }),
    );
    await humanTaskRepo.create(
      buildHumanTask({ id: 't2', processInstanceId: 'inst-2', assignedRole: 'reviewer', status: 'claimed' }),
    );
    await humanTaskRepo.create(
      buildHumanTask({ id: 't3', processInstanceId: 'inst-3', assignedRole: 'reviewer', status: 'pending' }),
    );

    const scope = createTestScope({ humanTaskRepo, instanceRepo });
    const result = await getMonitoringSummary({ handle: 'team-alpha' }, scope);

    expect(result.summary.runs.running).toBe(1);
    expect(result.summary.runs.paused).toBe(1);
    expect(result.summary.tasks.pending).toBe(1);
    expect(result.summary.tasks.claimed).toBe(1);
    expect(result.summary.roleTaskCounts).toEqual({
      reviewer: { pending: 1, claimed: 1 },
    });
  });

  it('counts archived runs in their status bucket (parity with pre-PR2 useMonitoringData)', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-1', namespace: 'h', status: 'completed', archived: true }),
    );
    await humanTaskRepo.create(
      buildHumanTask({ id: 't1', processInstanceId: 'inst-1', assignedRole: 'r', status: 'pending' }),
    );

    const scope = createTestScope({ humanTaskRepo, instanceRepo });
    const result = await getMonitoringSummary({ handle: 'h' }, scope);
    expect(result.summary.runs.completed).toBe(1);
    expect(result.summary.runs.running).toBe(0);
    expect(result.summary.tasks.pending).toBe(1);
  });

  it('counts completed and failed runs regardless of age', async () => {
    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-old-c', namespace: 'h', status: 'completed', updatedAt: longAgo }),
    );
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-old-f', namespace: 'h', status: 'failed', updatedAt: longAgo }),
    );

    const scope = createTestScope({ humanTaskRepo, instanceRepo });
    const result = await getMonitoringSummary({ handle: 'h' }, scope);
    expect(result.summary.runs.completed).toBe(1);
    expect(result.summary.runs.failed).toBe(1);
  });

  it('throws ForbiddenError when user caller is not a member of handle', async () => {
    const scope = createTestScope({
      humanTaskRepo,
      instanceRepo,
      caller: userCaller('u-1', ['team-other']),
    });
    await expect(getMonitoringSummary({ handle: 'team-alpha' }, scope)).rejects.toThrow();
  });
});
