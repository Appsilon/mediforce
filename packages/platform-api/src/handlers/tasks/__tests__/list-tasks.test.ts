import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryHumanTaskRepository,
  buildHumanTask,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { listTasks } from '../list-tasks.js';
import { ACTIONABLE_STATUSES } from '../../../contract/tasks.js';

/**
 * Handler behaviour tests: exercise `listTasks` against a real in-memory
 * `HumanTaskRepository` — no mocks, no HTTP. Contract validation itself
 * lives in `contract.test.ts`; here we verify the handler's behaviour given
 * already-validated inputs.
 */

describe('listTasks handler', () => {
  let humanTaskRepo: InMemoryHumanTaskRepository;

  beforeEach(() => {
    resetFactorySequence();
    humanTaskRepo = new InMemoryHumanTaskRepository();
  });

  describe('filtering by instanceId', () => {
    it('returns only tasks for the given instance', async () => {
      await humanTaskRepo.create(buildHumanTask({ id: 't1', processInstanceId: 'inst-a' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't2', processInstanceId: 'inst-b' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't3', processInstanceId: 'inst-a' }));

      const result = await listTasks({ instanceId: 'inst-a' }, { humanTaskRepo });

      expect(result.tasks.map((t) => t.id).sort()).toEqual(['t1', 't3']);
    });

    it('returns empty array when instance has no tasks', async () => {
      const result = await listTasks({ instanceId: 'inst-missing' }, { humanTaskRepo });
      expect(result.tasks).toEqual([]);
    });
  });

  describe('filtering by role', () => {
    it('returns every task for the role regardless of status (no filter)', async () => {
      await humanTaskRepo.create(buildHumanTask({ id: 't1', assignedRole: 'reviewer', status: 'pending' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't2', assignedRole: 'reviewer', status: 'completed' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't3', assignedRole: 'reviewer', status: 'cancelled' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't4', assignedRole: 'approver', status: 'pending' }));

      const result = await listTasks({ role: 'reviewer' }, { humanTaskRepo });

      expect(result.tasks.map((t) => t.id).sort()).toEqual(['t1', 't2', 't3']);
    });
  });

  describe('status[] filter', () => {
    it('narrows to a single status', async () => {
      await humanTaskRepo.create(buildHumanTask({ id: 't1', processInstanceId: 'inst-a', status: 'pending' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't2', processInstanceId: 'inst-a', status: 'completed' }));

      const result = await listTasks(
        { instanceId: 'inst-a', status: ['completed'] },
        { humanTaskRepo },
      );

      expect(result.tasks.map((t) => t.id)).toEqual(['t2']);
    });

    it('includes tasks matching any of the listed statuses', async () => {
      await humanTaskRepo.create(buildHumanTask({ id: 't1', assignedRole: 'reviewer', status: 'pending' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't2', assignedRole: 'reviewer', status: 'claimed' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't3', assignedRole: 'reviewer', status: 'completed' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't4', assignedRole: 'reviewer', status: 'cancelled' }));

      const result = await listTasks(
        { role: 'reviewer', status: [...ACTIONABLE_STATUSES] },
        { humanTaskRepo },
      );

      expect(result.tasks.map((t) => t.id).sort()).toEqual(['t1', 't2']);
    });

    it('returns empty when no task matches the status list', async () => {
      await humanTaskRepo.create(buildHumanTask({ id: 't1', processInstanceId: 'inst-a', status: 'pending' }));

      const result = await listTasks(
        { instanceId: 'inst-a', status: ['completed', 'cancelled'] },
        { humanTaskRepo },
      );

      expect(result.tasks).toEqual([]);
    });
  });

  describe('stepId filter', () => {
    it('narrows to the requested step within an instance', async () => {
      await humanTaskRepo.create(buildHumanTask({ id: 't1', processInstanceId: 'inst-a', stepId: 'review' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't2', processInstanceId: 'inst-a', stepId: 'approve' }));

      const result = await listTasks(
        { instanceId: 'inst-a', stepId: 'approve' },
        { humanTaskRepo },
      );

      expect(result.tasks.map((t) => t.id)).toEqual(['t2']);
    });

    it('combines with status — both filters apply', async () => {
      await humanTaskRepo.create(buildHumanTask({ id: 't1', processInstanceId: 'inst-a', stepId: 'review', status: 'pending' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't2', processInstanceId: 'inst-a', stepId: 'review', status: 'completed' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't3', processInstanceId: 'inst-a', stepId: 'approve', status: 'pending' }));

      const result = await listTasks(
        { instanceId: 'inst-a', stepId: 'review', status: ['pending'] },
        { humanTaskRepo },
      );

      expect(result.tasks.map((t) => t.id)).toEqual(['t1']);
    });
  });
});
