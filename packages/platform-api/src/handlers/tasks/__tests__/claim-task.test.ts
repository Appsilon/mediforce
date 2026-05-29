import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryHumanTaskRepository,
  InMemoryProcessInstanceRepository,
  buildHumanTask,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { claimTask } from '../claim-task';
import {
  ForbiddenError,
  HandlerError,
  NotFoundError,
  PreconditionFailedError,
} from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';

/**
 * Handler tests for `claimTask`. Exercise the handler against real in-memory
 * repos through `createTestScope` — same pattern as `list-tasks.test.ts`.
 *
 * Auth carrier semantics (PR1 decision, ADR-0005 §6):
 *   - The claimer's `uid` comes from `scope.caller`, not the request body.
 *     The old inline route accepted `body.userId` (falling back to
 *     `'api-user'`); the migrated handler treats the auth carrier as the
 *     single source of truth.
 *   - `apiKey` callers have no human user to assign a claim to and are
 *     refused with `forbidden` rather than silently assigning to a magic id.
 */

describe('claimTask handler', () => {
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
    it('returns the task in status `claimed` with the caller as assignee', async () => {
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

      const result = await claimTask({ taskId: 'task-1' }, scope);

      expect(result.task.id).toBe('task-1');
      expect(result.task.status).toBe('claimed');
      expect(result.task.assignedUserId).toBe('u-1');
    });

    it('emits a `task.claimed` audit event with snapshots and basis', async () => {
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

      await claimTask({ taskId: 'task-1' }, scope);

      const events = await auditRepo.getByProcess('inst-a');
      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.action).toBe('task.claimed');
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
      expect(event.outputSnapshot).toMatchObject({
        status: 'claimed',
        assignedUserId: 'u-1',
      });
      expect(event.basis).toBe('User claimed task via UI');
    });
  });

  describe('precondition failures', () => {
    it('throws PreconditionFailedError when the task is not pending', async () => {
      await humanTaskRepo.create(
        buildHumanTask({
          id: 'task-1',
          processInstanceId: 'inst-a',
          status: 'claimed',
          assignedUserId: 'u-other',
        }),
      );
      const scope = createTestScope({
        humanTaskRepo,
        instanceRepo,
        auditRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      const err = await claimTask({ taskId: 'task-1' }, scope).catch((e) => e);

      expect(err).toBeInstanceOf(PreconditionFailedError);
      expect(err).toBeInstanceOf(HandlerError);
      expect((err as PreconditionFailedError).code).toBe('precondition_failed');
      expect((err as PreconditionFailedError).message).toMatch(/claim|pending/i);
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

      const err = await claimTask({ taskId: 'task-missing' }, scope).catch((e) => e);

      expect(err).toBeInstanceOf(NotFoundError);
      expect((err as NotFoundError).code).toBe('not_found');
    });

    it('throws NotFoundError for a foreign-workspace task (anti-enum)', async () => {
      // Task exists, but in a workspace the caller is not a member of.
      // Per ADR-0005 §3 / Phase 1 anti-enum, this surfaces as 404, not 403.
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

      const err = await claimTask({ taskId: 'task-foreign' }, scope).catch((e) => e);

      expect(err).toBeInstanceOf(NotFoundError);
      expect((err as NotFoundError).code).toBe('not_found');
    });
  });

  describe('caller-kind gate', () => {
    it('throws ForbiddenError for apiKey callers (no human to assign)', async () => {
      // The auth carrier is the source of truth for the claimer's identity;
      // apiKey (system actor) has no `uid`, so it has nothing to assign.
      // The old inline route silently fell back to a magic 'api-user' string —
      // we deliberately drop that for PR1.
      await humanTaskRepo.create(
        buildHumanTask({ id: 'task-1', processInstanceId: 'inst-a', status: 'pending' }),
      );
      const scope = createTestScope({
        humanTaskRepo,
        instanceRepo,
        auditRepo,
        // default caller in createTestScope is apiKey
      });

      const err = await claimTask({ taskId: 'task-1' }, scope).catch((e) => e);

      expect(err).toBeInstanceOf(ForbiddenError);
      expect((err as ForbiddenError).code).toBe('forbidden');
      expect((err as ForbiddenError).message).toMatch(/system actor|claim/i);
    });
  });
});
