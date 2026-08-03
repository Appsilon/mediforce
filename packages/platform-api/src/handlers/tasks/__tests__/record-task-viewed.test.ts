import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryHumanTaskRepository,
  InMemoryProcessInstanceRepository,
  buildHumanTask,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { recordTaskViewed } from '../record-task-viewed';
import { ForbiddenError, NotFoundError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';

/**
 * Handler tests for `recordTaskViewed`. Same pattern as `claim-task.test.ts`
 * — no state change on the task itself, just a `task.viewed` audit event so
 * Monitoring → Tasks has a real "viewed" signal instead of no data at all.
 */

describe('recordTaskViewed handler', () => {
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(async () => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    humanTaskRepo = new InMemoryHumanTaskRepository(instanceRepo);
    auditRepo = new InMemoryAuditRepository(instanceRepo);
    await instanceRepo.create(buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha' }));
  });

  describe('happy path', () => {
    it('returns recorded: true and does not change the task', async () => {
      await humanTaskRepo.create(
        buildHumanTask({
          id: 'task-1',
          processInstanceId: 'inst-a',
          stepId: 'review',
          status: 'pending',
        }),
      );
      const scope = createTestScope({
        humanTaskRepo,
        instanceRepo,
        auditRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      const result = await recordTaskViewed({ taskId: 'task-1' }, scope);

      expect(result).toEqual({ recorded: true });
      const task = await scope.tasks.getById('task-1');
      expect(task?.status).toBe('pending');
    });

    it('emits a `task.viewed` audit event with snapshots and basis', async () => {
      await humanTaskRepo.create(
        buildHumanTask({
          id: 'task-1',
          processInstanceId: 'inst-a',
          stepId: 'review',
          status: 'pending',
        }),
      );
      const scope = createTestScope({
        humanTaskRepo,
        instanceRepo,
        auditRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      await recordTaskViewed({ taskId: 'task-1' }, scope);

      const events = await auditRepo.getByProcess('inst-a');
      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.action).toBe('task.viewed');
      expect(event.actorId).toBe('u-1');
      expect(event.actorType).toBe('user');
      expect(event.entityType).toBe('humanTask');
      expect(event.entityId).toBe('task-1');
      expect(event.processInstanceId).toBe('inst-a');
      expect(event.inputSnapshot).toMatchObject({
        taskId: 'task-1',
        userId: 'u-1',
        stepId: 'review',
      });
      expect(event.basis).toBe('User viewed task via UI');
    });
  });

  describe('not-found / foreign-workspace', () => {
    it('throws NotFoundError when the task does not exist', async () => {
      const scope = createTestScope({
        humanTaskRepo,
        instanceRepo,
        auditRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      const err = await recordTaskViewed({ taskId: 'task-missing' }, scope).catch((e) => e);

      expect(err).toBeInstanceOf(NotFoundError);
      expect((err as NotFoundError).code).toBe('not_found');
    });

    it('throws NotFoundError for a foreign-workspace task (anti-enum)', async () => {
      await instanceRepo.create(buildProcessInstance({ id: 'inst-b', namespace: 'team-beta' }));
      await humanTaskRepo.create(
        buildHumanTask({ id: 'task-foreign', processInstanceId: 'inst-b', status: 'pending' }),
      );
      const scope = createTestScope({
        humanTaskRepo,
        instanceRepo,
        auditRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      const err = await recordTaskViewed({ taskId: 'task-foreign' }, scope).catch((e) => e);

      expect(err).toBeInstanceOf(NotFoundError);
      expect((err as NotFoundError).code).toBe('not_found');
    });
  });

  describe('caller-kind gate', () => {
    it('throws ForbiddenError for apiKey callers (no human to attribute the view to)', async () => {
      await humanTaskRepo.create(
        buildHumanTask({ id: 'task-1', processInstanceId: 'inst-a', status: 'pending' }),
      );
      const scope = createTestScope({
        humanTaskRepo,
        instanceRepo,
        auditRepo,
        // default caller in createTestScope is apiKey
      });

      const err = await recordTaskViewed({ taskId: 'task-1' }, scope).catch((e) => e);

      expect(err).toBeInstanceOf(ForbiddenError);
      expect((err as ForbiddenError).code).toBe('forbidden');
      expect((err as ForbiddenError).message).toMatch(/system actor|view/i);
    });
  });
});
