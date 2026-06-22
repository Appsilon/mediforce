import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryHumanTaskRepository,
  InMemoryProcessInstanceRepository,
  buildHumanTask,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { listTasks } from '../list-tasks';
import { ACTIONABLE_STATUSES } from '../../../contract/tasks';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

/**
 * Handler behaviour tests: exercise `listTasks` against real in-memory repos —
 * no mocks, no HTTP. Contract validation itself lives in `contract.test.ts`;
 * here we verify the handler's behaviour given already-validated inputs.
 *
 * Default caller is `apiKey` (unrestricted) so each test focuses on filter
 * semantics. The `caller-driven namespace filtering` block exercises the
 * `user` caller path.
 */

describe('listTasks handler', () => {
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(() => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    humanTaskRepo = new InMemoryHumanTaskRepository(instanceRepo);
  });

  describe('filtering by instanceId', () => {
    it('returns only tasks for the given instance', async () => {
      await humanTaskRepo.create(buildHumanTask({ id: 't1', processInstanceId: 'inst-a' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't2', processInstanceId: 'inst-b' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't3', processInstanceId: 'inst-a' }));

      const scope = createTestScope({ humanTaskRepo, instanceRepo });
      const result = await listTasks({ instanceId: 'inst-a' }, scope);

      expect(result.tasks.map((t) => t.id).sort()).toEqual(['t1', 't3']);
    });

    it('returns empty array when instance has no tasks', async () => {
      const scope = createTestScope({ humanTaskRepo, instanceRepo });
      const result = await listTasks({ instanceId: 'inst-missing' }, scope);
      expect(result.tasks).toEqual([]);
    });
  });

  describe('filtering by role', () => {
    it('returns every task for the role regardless of status (no filter)', async () => {
      await humanTaskRepo.create(buildHumanTask({ id: 't1', assignedRole: 'reviewer', status: 'pending' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't2', assignedRole: 'reviewer', status: 'completed' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't3', assignedRole: 'reviewer', status: 'cancelled' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't4', assignedRole: 'approver', status: 'pending' }));

      const scope = createTestScope({ humanTaskRepo, instanceRepo });
      const result = await listTasks({ role: 'reviewer' }, scope);

      expect(result.tasks.map((t) => t.id).sort()).toEqual(['t1', 't2', 't3']);
    });
  });

  describe('status[] filter', () => {
    it('narrows to a single status', async () => {
      await humanTaskRepo.create(buildHumanTask({ id: 't1', processInstanceId: 'inst-a', status: 'pending' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't2', processInstanceId: 'inst-a', status: 'completed' }));

      const scope = createTestScope({ humanTaskRepo, instanceRepo });
      const result = await listTasks({ instanceId: 'inst-a', status: ['completed'] }, scope);

      expect(result.tasks.map((t) => t.id)).toEqual(['t2']);
    });

    it('includes tasks matching any of the listed statuses', async () => {
      await humanTaskRepo.create(buildHumanTask({ id: 't1', assignedRole: 'reviewer', status: 'pending' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't2', assignedRole: 'reviewer', status: 'claimed' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't3', assignedRole: 'reviewer', status: 'completed' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't4', assignedRole: 'reviewer', status: 'cancelled' }));

      const scope = createTestScope({ humanTaskRepo, instanceRepo });
      const result = await listTasks({ role: 'reviewer', status: [...ACTIONABLE_STATUSES] }, scope);

      expect(result.tasks.map((t) => t.id).sort()).toEqual(['t1', 't2']);
    });

    it('returns empty when no task matches the status list', async () => {
      await humanTaskRepo.create(buildHumanTask({ id: 't1', processInstanceId: 'inst-a', status: 'pending' }));

      const scope = createTestScope({ humanTaskRepo, instanceRepo });
      const result = await listTasks({ instanceId: 'inst-a', status: ['completed', 'cancelled'] }, scope);

      expect(result.tasks).toEqual([]);
    });
  });

  describe('stepId filter', () => {
    it('narrows to the requested step within an instance', async () => {
      await humanTaskRepo.create(buildHumanTask({ id: 't1', processInstanceId: 'inst-a', stepId: 'review' }));
      await humanTaskRepo.create(buildHumanTask({ id: 't2', processInstanceId: 'inst-a', stepId: 'approve' }));

      const scope = createTestScope({ humanTaskRepo, instanceRepo });
      const result = await listTasks({ instanceId: 'inst-a', stepId: 'approve' }, scope);

      expect(result.tasks.map((t) => t.id)).toEqual(['t2']);
    });

    it('combines with status — both filters apply', async () => {
      await humanTaskRepo.create(
        buildHumanTask({ id: 't1', processInstanceId: 'inst-a', stepId: 'review', status: 'pending' }),
      );
      await humanTaskRepo.create(
        buildHumanTask({ id: 't2', processInstanceId: 'inst-a', stepId: 'review', status: 'completed' }),
      );
      await humanTaskRepo.create(
        buildHumanTask({ id: 't3', processInstanceId: 'inst-a', stepId: 'approve', status: 'pending' }),
      );

      const scope = createTestScope({ humanTaskRepo, instanceRepo });
      const result = await listTasks({ instanceId: 'inst-a', stepId: 'review', status: ['pending'] }, scope);

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
      const scope = createTestScope({ humanTaskRepo, instanceRepo });
      const result = await listTasks({ role: 'reviewer' }, scope);
      expect(result.tasks.map((t) => t.id).sort()).toEqual(['t-alpha', 't-beta', 't-orphan']);
    });

    it('returns only tasks in the user caller’s namespaces', async () => {
      const scope = createTestScope({
        humanTaskRepo,
        instanceRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      const result = await listTasks({ role: 'reviewer' }, scope);

      expect(result.tasks.map((t) => t.id)).toEqual(['t-alpha']);
    });

    it('drops tasks whose instance has no namespace', async () => {
      const scope = createTestScope({
        humanTaskRepo,
        instanceRepo,
        caller: userCaller('u-2', ['team-alpha', 'team-beta']),
      });

      const result = await listTasks({ role: 'reviewer' }, scope);

      expect(result.tasks.map((t) => t.id).sort()).toEqual(['t-alpha', 't-beta']);
    });

    it('returns empty when the user has no overlap with any task’s namespace', async () => {
      const scope = createTestScope({
        humanTaskRepo,
        instanceRepo,
        caller: userCaller('u-3', ['team-gamma']),
      });

      const result = await listTasks({ role: 'reviewer' }, scope);

      expect(result.tasks).toEqual([]);
    });
  });

  /**
   * GitHub-like default: bare endpoint with no axis returns the caller's
   * workspace-visible queue. System actors see everything; user callers see
   * tasks whose parent run is in their namespaces (across all roles +
   * instances).
   */
  describe('caller-scope axis (no instanceId, no role)', () => {
    beforeEach(async () => {
      await instanceRepo.create(buildProcessInstance({ id: 'inst-alpha', namespace: 'team-alpha' }));
      await instanceRepo.create(buildProcessInstance({ id: 'inst-beta', namespace: 'team-beta' }));
      await instanceRepo.create(buildProcessInstance({ id: 'inst-orphan', namespace: undefined }));
      await humanTaskRepo.create(
        buildHumanTask({ id: 't-a1', processInstanceId: 'inst-alpha', assignedRole: 'reviewer', status: 'pending' }),
      );
      await humanTaskRepo.create(
        buildHumanTask({ id: 't-a2', processInstanceId: 'inst-alpha', assignedRole: 'approver', status: 'claimed' }),
      );
      await humanTaskRepo.create(
        buildHumanTask({ id: 't-a3', processInstanceId: 'inst-alpha', assignedRole: 'reviewer', status: 'completed' }),
      );
      await humanTaskRepo.create(
        buildHumanTask({ id: 't-b1', processInstanceId: 'inst-beta', assignedRole: 'reviewer', status: 'pending' }),
      );
      await humanTaskRepo.create(
        buildHumanTask({
          id: 't-orphan',
          processInstanceId: 'inst-orphan',
          assignedRole: 'reviewer',
          status: 'pending',
        }),
      );
    });

    it('returns every task across all namespaces for api-key callers', async () => {
      const scope = createTestScope({ humanTaskRepo, instanceRepo });
      const result = await listTasks({}, scope);
      expect(result.tasks.map((t) => t.id).sort()).toEqual(['t-a1', 't-a2', 't-a3', 't-b1', 't-orphan']);
    });

    it('returns only tasks in the user caller’s namespaces, across roles', async () => {
      const scope = createTestScope({
        humanTaskRepo,
        instanceRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });
      const result = await listTasks({}, scope);
      expect(result.tasks.map((t) => t.id).sort()).toEqual(['t-a1', 't-a2', 't-a3']);
    });

    it('combines with status[] filter — caller scope + actionable only', async () => {
      const scope = createTestScope({
        humanTaskRepo,
        instanceRepo,
        caller: userCaller('u-2', ['team-alpha', 'team-beta']),
      });
      const result = await listTasks({ status: [...ACTIONABLE_STATUSES] }, scope);
      expect(result.tasks.map((t) => t.id).sort()).toEqual(['t-a1', 't-a2', 't-b1']);
    });

    it('drops tasks whose parent instance has no namespace, for user callers', async () => {
      const scope = createTestScope({
        humanTaskRepo,
        instanceRepo,
        caller: userCaller('u-3', ['team-alpha', 'team-beta']),
      });
      const result = await listTasks({}, scope);
      expect(result.tasks.map((t) => t.id).sort()).toEqual(['t-a1', 't-a2', 't-a3', 't-b1']);
    });

    it('returns empty when user has no namespace overlap', async () => {
      const scope = createTestScope({
        humanTaskRepo,
        instanceRepo,
        caller: userCaller('u-4', ['team-gamma']),
      });
      const result = await listTasks({}, scope);
      expect(result.tasks).toEqual([]);
    });
  });
});
