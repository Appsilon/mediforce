import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { HumanTaskStatus, InstanceStatus } from '@mediforce/platform-core';
import {
  InMemoryHumanTaskRepository,
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  buildHumanTask,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { completeTask, type EngineLike } from '../complete-task.js';
import { ConflictError, NotFoundError } from '../../../errors.js';

type AdvanceStepFn = EngineLike['advanceStep'];

describe('completeTask handler', () => {
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;
  let advanceStep: ReturnType<typeof vi.fn<AdvanceStepFn>>;

  beforeEach(async () => {
    resetFactorySequence();
    humanTaskRepo = new InMemoryHumanTaskRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository();
    advanceStep = vi.fn<AdvanceStepFn>().mockResolvedValue(undefined);
  });

  async function seed({
    taskStatus = 'claimed' as HumanTaskStatus,
    instanceStatus = 'paused' as InstanceStatus,
    completionData = null as Record<string, unknown> | null,
  } = {}) {
    await humanTaskRepo.create(
      buildHumanTask({
        id: 'task-1',
        status: taskStatus,
        processInstanceId: 'inst-a',
        assignedUserId: 'alice',
        completionData,
      }),
    );
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-a', status: instanceStatus }),
    );
  }

  const deps = () => ({
    humanTaskRepo,
    instanceRepo,
    auditRepo,
    engine: { advanceStep },
  });

  it('completes a claimed task and returns the summary', async () => {
    await seed();

    const result = await completeTask(
      { taskId: 'task-1', verdict: 'approve' },
      deps(),
    );

    expect(result).toEqual({
      ok: true,
      taskId: 'task-1',
      verdict: 'approve',
      processInstanceId: 'inst-a',
    });

    const updated = await humanTaskRepo.getById('task-1');
    expect(updated?.status).toBe('completed');
  });

  it('resumes the paused instance and advances the engine once', async () => {
    await seed();

    await completeTask(
      { taskId: 'task-1', verdict: 'revise', comment: 'needs fix' },
      deps(),
    );

    const instance = await instanceRepo.getById('inst-a');
    expect(instance?.status).toBe('running');
    expect(instance?.pauseReason).toBeNull();

    expect(advanceStep).toHaveBeenCalledTimes(1);
    expect(advanceStep).toHaveBeenCalledWith(
      'inst-a',
      expect.objectContaining({ verdict: 'revise', comment: 'needs fix' }),
      { id: 'alice', role: 'human' },
    );
  });

  it('forwards agent output into stepOutput for L3 review tasks', async () => {
    await seed({
      completionData: {
        reviewType: 'agent_output_review',
        agentOutput: { result: { verdict: 'auto-approve', score: 0.9 } },
      },
    });

    await completeTask({ taskId: 'task-1', verdict: 'approve' }, deps());

    const firstCallArgs = advanceStep.mock.calls[0];
    expect(firstCallArgs?.[1]).toMatchObject({
      verdict: 'approve',
      agentOutput: { verdict: 'auto-approve', score: 0.9 },
    });
  });

  it('writes task.completed and process.resumed_after_task audit events', async () => {
    await seed();

    await completeTask({ taskId: 'task-1', verdict: 'approve' }, deps());

    const events = auditRepo.getAll();
    const actions = events.map((e) => e.action);
    expect(actions).toContain('task.completed');
    expect(actions).toContain('process.resumed_after_task');
  });

  it('calls triggerRun when provided', async () => {
    await seed();
    const triggerRun = vi.fn();

    await completeTask(
      { taskId: 'task-1', verdict: 'approve' },
      { ...deps(), triggerRun },
    );

    expect(triggerRun).toHaveBeenCalledWith('inst-a', 'alice');
  });

  it('throws NotFoundError when task is missing', async () => {
    await expect(
      completeTask({ taskId: 'missing', verdict: 'approve' }, deps()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ConflictError when task is not claimed', async () => {
    await seed({ taskStatus: 'pending' });

    await expect(
      completeTask({ taskId: 'task-1', verdict: 'approve' }, deps()),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('throws NotFoundError when process instance vanished', async () => {
    await humanTaskRepo.create(
      buildHumanTask({
        id: 'orphan',
        status: 'claimed',
        processInstanceId: 'missing',
        assignedUserId: 'alice',
      }),
    );

    await expect(
      completeTask({ taskId: 'orphan', verdict: 'approve' }, deps()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ConflictError when instance is not paused', async () => {
    await seed({ instanceStatus: 'running' });

    await expect(
      completeTask({ taskId: 'task-1', verdict: 'approve' }, deps()),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
