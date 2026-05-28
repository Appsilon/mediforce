import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryHumanTaskRepository,
  InMemoryProcessInstanceRepository,
  buildHumanTask,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { getMonitoringSummary } from '../get-monitoring-summary.js';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope.js';

describe('getMonitoringSummary handler', () => {
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(() => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    humanTaskRepo = new InMemoryHumanTaskRepository(instanceRepo);
  });

  it('aggregates runs and tasks scoped to a single workspace', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-1', namespace: 'team-alpha', status: 'running' }),
    );
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-2', namespace: 'team-alpha', status: 'paused' }),
    );
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-3', namespace: 'team-beta', status: 'running' }),
    );
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

  it('counts archived runs separately and skips their tasks', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-1', namespace: 'h', status: 'completed', archived: true }),
    );
    await humanTaskRepo.create(
      buildHumanTask({ id: 't1', processInstanceId: 'inst-1', assignedRole: 'r', status: 'pending' }),
    );

    const scope = createTestScope({ humanTaskRepo, instanceRepo });
    const result = await getMonitoringSummary({ handle: 'h' }, scope);
    expect(result.summary.runs.archived_total).toBe(1);
    expect(result.summary.runs.running).toBe(0);
    expect(result.summary.tasks.pending).toBe(0);
  });

  it('marks claimed tasks older than 24h as stuck', async () => {
    const longAgo = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    const recent = new Date(Date.now() - 60 * 1000).toISOString();
    await instanceRepo.create(buildProcessInstance({ id: 'inst-1', namespace: 'h', status: 'running' }));
    await humanTaskRepo.create(
      buildHumanTask({
        id: 't-old',
        processInstanceId: 'inst-1',
        assignedRole: 'r',
        status: 'claimed',
        updatedAt: longAgo,
      }),
    );
    await humanTaskRepo.create(
      buildHumanTask({
        id: 't-new',
        processInstanceId: 'inst-1',
        assignedRole: 'r',
        status: 'claimed',
        updatedAt: recent,
      }),
    );

    const scope = createTestScope({ humanTaskRepo, instanceRepo });
    const result = await getMonitoringSummary({ handle: 'h' }, scope);
    expect(result.summary.tasks.stuck_count).toBe(1);
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
