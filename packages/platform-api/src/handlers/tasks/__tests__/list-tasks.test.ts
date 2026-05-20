import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryHumanTaskRepository,
  InMemoryProcessInstanceRepository,
  buildHumanTask,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { listTasks } from '../list-tasks.js';
import { ACTIONABLE_STATUSES } from '../../../contract/tasks.js';
import type { CallerIdentity } from '../../../auth.js';

/**
 * Handler behaviour tests: exercise `listTasks` against real in-memory repos —
 * no mocks, no HTTP. Contract validation itself lives in `contract.test.ts`;
 * here we verify the handler's behaviour given already-validated inputs.
 *
 * Default caller is `apiKey` (unrestricted) so each test focuses on filter
 * semantics. The `caller-driven namespace filtering` block exercises the
 * `user` caller path.
 */

const apiKey: CallerIdentity = { kind: 'apiKey' };

describe('listTasks handler', () => {
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(() => {
    resetFactorySequence();
    humanTaskRepo = new InMemoryHumanTaskRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();
  });

  describe('filtering by instanceId', () => {
    it('returns only tasks for the given instance', async () => {
      await humanTaskRepo.create(buildHumanTask({ id: 't1', processInstanceId: 'inst-a' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't2', processInstanceId: 'inst-b' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't3', processInstanceId: 'inst-a' }));

      const result = await listTasks({ instanceId: 'inst-a' }, { humanTaskRepo, instanceRepo }, apiKey);

      expect(result.tasks.map((t) => t.id).sort()).toEqual(['t1', 't3']);
    });

    it('returns empty array when instance has no tasks', async () => {
      const result = await listTasks(
        { instanceId: 'inst-missing' },
        { humanTaskRepo, instanceRepo },
        apiKey,
      );
      expect(result.tasks).toEqual([]);
    });
  });

  describe('filtering by role', () => {
    it('returns every task for the role regardless of status (no filter)', async () => {
      await humanTaskRepo.create(buildHumanTask({ id: 't1', assignedRole: 'reviewer', status: 'pending' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't2', assignedRole: 'reviewer', status: 'completed' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't3', assignedRole: 'reviewer', status: 'cancelled' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't4', assignedRole: 'approver', status: 'pending' }));

      const result = await listTasks({ role: 'reviewer' }, { humanTaskRepo, instanceRepo }, apiKey);

      expect(result.tasks.map((t) => t.id).sort()).toEqual(['t1', 't2', 't3']);
    });
  });

  describe('status[] filter', () => {
    it('narrows to a single status', async () => {
      await humanTaskRepo.create(buildHumanTask({ id: 't1', processInstanceId: 'inst-a', status: 'pending' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't2', processInstanceId: 'inst-a', status: 'completed' }));

      const result = await listTasks(
        { instanceId: 'inst-a', status: ['completed'] },
        { humanTaskRepo, instanceRepo },
        apiKey,
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
        { humanTaskRepo, instanceRepo },
        apiKey,
      );

      expect(result.tasks.map((t) => t.id).sort()).toEqual(['t1', 't2']);
    });

    it('returns empty when no task matches the status list', async () => {
      await humanTaskRepo.create(buildHumanTask({ id: 't1', processInstanceId: 'inst-a', status: 'pending' }));

      const result = await listTasks(
        { instanceId: 'inst-a', status: ['completed', 'cancelled'] },
        { humanTaskRepo, instanceRepo },
        apiKey,
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
        { humanTaskRepo, instanceRepo },
        apiKey,
      );

      expect(result.tasks.map((t) => t.id)).toEqual(['t2']);
    });

    it('combines with status — both filters apply', async () => {
      await humanTaskRepo.create(buildHumanTask({ id: 't1', processInstanceId: 'inst-a', stepId: 'review', status: 'pending' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't2', processInstanceId: 'inst-a', stepId: 'review', status: 'completed' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't3', processInstanceId: 'inst-a', stepId: 'approve', status: 'pending' }));

      const result = await listTasks(
        { instanceId: 'inst-a', stepId: 'review', status: ['pending'] },
        { humanTaskRepo, instanceRepo },
        apiKey,
      );

      expect(result.tasks.map((t) => t.id)).toEqual(['t1']);
    });
  });

  describe('caller-driven namespace filtering', () => {
    beforeEach(async () => {
      // Two instances in different namespaces; each has one task.
      await instanceRepo.create(buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha' }));
      await instanceRepo.create(buildProcessInstance({ id: 'inst-b', namespace: 'team-beta' }));
      await instanceRepo.create(buildProcessInstance({ id: 'inst-c', namespace: undefined }));
      await humanTaskRepo.create(
        buildHumanTask({ id: 't-alpha', processInstanceId: 'inst-a', assignedRole: 'reviewer' }),
      );
      await humanTaskRepo.create(
        buildHumanTask({ id: 't-beta', processInstanceId: 'inst-b', assignedRole: 'reviewer' }),
      );
      await humanTaskRepo.create(
        buildHumanTask({ id: 't-orphan', processInstanceId: 'inst-c', assignedRole: 'reviewer' }),
      );
    });

    it('returns every task for api-key callers regardless of namespace', async () => {
      const result = await listTasks({ role: 'reviewer' }, { humanTaskRepo, instanceRepo }, apiKey);
      expect(result.tasks.map((t) => t.id).sort()).toEqual(['t-alpha', 't-beta', 't-orphan']);
    });

    it('returns only tasks in the user caller’s namespaces', async () => {
      const userInAlpha: CallerIdentity = {
        kind: 'user',
        uid: 'u-1',
        namespaces: new Set(['team-alpha']),
      };

      const result = await listTasks(
        { role: 'reviewer' },
        { humanTaskRepo, instanceRepo },
        userInAlpha,
      );

      expect(result.tasks.map((t) => t.id)).toEqual(['t-alpha']);
    });

    it('drops tasks whose instance has no namespace', async () => {
      const userInAll: CallerIdentity = {
        kind: 'user',
        uid: 'u-2',
        namespaces: new Set(['team-alpha', 'team-beta']),
      };

      const result = await listTasks(
        { role: 'reviewer' },
        { humanTaskRepo, instanceRepo },
        userInAll,
      );

      expect(result.tasks.map((t) => t.id).sort()).toEqual(['t-alpha', 't-beta']);
    });

    it('returns empty when the user has no overlap with any task’s namespace', async () => {
      const userInOther: CallerIdentity = {
        kind: 'user',
        uid: 'u-3',
        namespaces: new Set(['team-gamma']),
      };

      const result = await listTasks(
        { role: 'reviewer' },
        { humanTaskRepo, instanceRepo },
        userInOther,
      );

      expect(result.tasks).toEqual([]);
    });
  });
});
