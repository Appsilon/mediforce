import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryHumanTaskRepository,
  InMemoryAuditRepository,
  buildHumanTask,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { claimTask } from '../claim-task.js';
import { ConflictError, NotFoundError } from '../../../errors.js';

describe('claimTask handler', () => {
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    resetFactorySequence();
    humanTaskRepo = new InMemoryHumanTaskRepository();
    auditRepo = new InMemoryAuditRepository();
  });

  it('claims a pending task and returns the claimed state', async () => {
    await humanTaskRepo.create(
      buildHumanTask({ id: 'task-1', status: 'pending', assignedUserId: null }),
    );

    const result = await claimTask(
      { taskId: 'task-1', userId: 'alice' },
      { humanTaskRepo, auditRepo },
    );

    expect(result.status).toBe('claimed');
    expect(result.assignedUserId).toBe('alice');
  });

  it('defaults userId to "api-user" when not provided', async () => {
    await humanTaskRepo.create(buildHumanTask({ id: 'task-1', status: 'pending' }));

    const result = await claimTask({ taskId: 'task-1' }, { humanTaskRepo, auditRepo });

    expect(result.assignedUserId).toBe('api-user');
  });

  it('writes a task.claimed audit event', async () => {
    await humanTaskRepo.create(
      buildHumanTask({ id: 'task-1', status: 'pending', processInstanceId: 'inst-a' }),
    );

    await claimTask({ taskId: 'task-1', userId: 'bob' }, { humanTaskRepo, auditRepo });

    const events = auditRepo.getAll();
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('task.claimed');
    expect(events[0]?.actorId).toBe('bob');
    expect(events[0]?.processInstanceId).toBe('inst-a');
  });

  it('throws NotFoundError when task does not exist', async () => {
    await expect(
      claimTask({ taskId: 'missing' }, { humanTaskRepo, auditRepo }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ConflictError when task is already claimed', async () => {
    await humanTaskRepo.create(
      buildHumanTask({ id: 'task-1', status: 'claimed', assignedUserId: 'earlier' }),
    );

    const err = await claimTask({ taskId: 'task-1' }, { humanTaskRepo, auditRepo }).catch(
      (e) => e,
    );

    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).statusCode).toBe(409);
    expect((err as ConflictError).message).toContain('claimed');
  });

  it('throws ConflictError for completed and cancelled tasks', async () => {
    await humanTaskRepo.create(buildHumanTask({ id: 'done', status: 'completed' }));
    await humanTaskRepo.create(buildHumanTask({ id: 'xxl', status: 'cancelled' }));

    await expect(
      claimTask({ taskId: 'done' }, { humanTaskRepo, auditRepo }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      claimTask({ taskId: 'xxl' }, { humanTaskRepo, auditRepo }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
