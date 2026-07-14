import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryHumanTaskRepository,
  InMemoryProcessInstanceRepository,
  buildHumanTask,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { cancelRun } from '../cancel-run';
import {
  HandlerError,
  NotFoundError,
  PreconditionFailedError,
} from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';

describe('cancelRun handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;
  let humanTaskRepo: InMemoryHumanTaskRepository;

  beforeEach(() => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
    humanTaskRepo = new InMemoryHumanTaskRepository(instanceRepo);
  });

  describe('happy path', () => {
    it('transitions a running run to failed and returns the post-mutation entity', async () => {
      await instanceRepo.create(
        buildProcessInstance({
          id: 'inst-a',
          namespace: 'team-alpha',
          status: 'running',
        }),
      );
      const scope = createTestScope({
        instanceRepo,
        auditRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      const result = await cancelRun({ runId: 'inst-a' }, scope);

      expect(result.run.id).toBe('inst-a');
      expect(result.run.status).toBe('failed');
      expect(result.run.error).toBe('Cancelled by user');
    });

    it('transitions a paused run to failed', async () => {
      await instanceRepo.create(
        buildProcessInstance({
          id: 'inst-paused',
          namespace: 'team-alpha',
          status: 'paused',
        }),
      );
      const scope = createTestScope({
        instanceRepo,
        auditRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      const result = await cancelRun({ runId: 'inst-paused' }, scope);

      expect(result.run.status).toBe('failed');
    });
  });

  describe('precondition failures', () => {
    it('throws PreconditionFailedError when the run is already failed', async () => {
      await instanceRepo.create(
        buildProcessInstance({
          id: 'inst-a',
          namespace: 'team-alpha',
          status: 'failed',
        }),
      );
      const scope = createTestScope({
        instanceRepo,
        auditRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      const err = await cancelRun({ runId: 'inst-a' }, scope).catch((e) => e);

      expect(err).toBeInstanceOf(PreconditionFailedError);
      expect(err).toBeInstanceOf(HandlerError);
      expect((err as PreconditionFailedError).code).toBe('precondition_failed');
      expect((err as PreconditionFailedError).message).toMatch(/failed/i);
    });

    it('throws PreconditionFailedError when the run is already completed', async () => {
      await instanceRepo.create(
        buildProcessInstance({
          id: 'inst-a',
          namespace: 'team-alpha',
          status: 'completed',
        }),
      );
      const scope = createTestScope({
        instanceRepo,
        auditRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      const err = await cancelRun({ runId: 'inst-a' }, scope).catch((e) => e);

      expect(err).toBeInstanceOf(PreconditionFailedError);
      expect((err as PreconditionFailedError).code).toBe('precondition_failed');
    });
  });

  describe('not-found / foreign-workspace', () => {
    it('throws NotFoundError when the instance does not exist', async () => {
      const scope = createTestScope({
        instanceRepo,
        auditRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      const err = await cancelRun({ runId: 'inst-missing' }, scope).catch((e) => e);

      expect(err).toBeInstanceOf(NotFoundError);
      expect((err as NotFoundError).code).toBe('not_found');
    });

    it('throws NotFoundError for a foreign-workspace instance (anti-enum)', async () => {
      // Instance exists but in a workspace the caller is not a member of.
      // Per ADR-0005 §3 / Phase 1 anti-enum, surfaces as 404 not 403.
      await instanceRepo.create(
        buildProcessInstance({
          id: 'inst-foreign',
          namespace: 'team-beta',
          status: 'running',
        }),
      );
      const scope = createTestScope({
        instanceRepo,
        auditRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      const err = await cancelRun({ runId: 'inst-foreign' }, scope).catch((e) => e);

      expect(err).toBeInstanceOf(NotFoundError);
      expect((err as NotFoundError).code).toBe('not_found');
    });
  });

  describe('audit emission', () => {
    it('emits an `instance.cancelled` audit event with actor, snapshots, basis', async () => {
      await instanceRepo.create(
        buildProcessInstance({
          id: 'inst-a',
          namespace: 'team-alpha',
          status: 'running',
          currentStepId: 'step-review',
          definitionVersion: '3',
        }),
      );
      const scope = createTestScope({
        instanceRepo,
        auditRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      await cancelRun({ runId: 'inst-a' }, scope);

      const events = await auditRepo.getByProcess('inst-a');
      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.action).toBe('instance.cancelled');
      expect(event.actorId).toBe('u-1');
      expect(event.actorType).toBe('user');
      expect(event.entityType).toBe('processInstance');
      expect(event.entityId).toBe('inst-a');
      expect(event.processInstanceId).toBe('inst-a');
      expect(event.processDefinitionVersion).toBe('3');
      expect(event.inputSnapshot).toMatchObject({
        previousStatus: 'running',
        currentStepId: 'step-review',
      });
      expect(event.outputSnapshot).toMatchObject({
        status: 'failed',
        error: 'Cancelled by user',
      });
      expect(event.basis).toMatch(/cancel/i);
    });

    it('uses the caller-supplied reason when provided', async () => {
      await instanceRepo.create(
        buildProcessInstance({
          id: 'inst-a',
          namespace: 'team-alpha',
          status: 'running',
        }),
      );
      const scope = createTestScope({
        instanceRepo,
        auditRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      const result = await cancelRun(
        { runId: 'inst-a', reason: 'Audit cleanup' },
        scope,
      );

      expect(result.run.error).toBe('Audit cleanup');
      const events = await auditRepo.getByProcess('inst-a');
      expect(events[0]!.outputSnapshot).toMatchObject({ error: 'Audit cleanup' });
    });

    it('attributes audit to "api" when the caller is a system actor (apiKey)', async () => {
      await instanceRepo.create(
        buildProcessInstance({
          id: 'inst-a',
          namespace: 'team-alpha',
          status: 'running',
        }),
      );
      const scope = createTestScope({
        instanceRepo,
        auditRepo,
        humanTaskRepo,
      });

      await cancelRun({ runId: 'inst-a' }, scope);

      const events = await auditRepo.getByProcess('inst-a');
      expect(events[0]!.actorId).toBe('api');
      expect(events[0]!.actorType).toBe('system');
    });
  });

  describe('task cascade', () => {
    it('cancels pending and claimed tasks when the run is cancelled', async () => {
      await instanceRepo.create(
        buildProcessInstance({
          id: 'inst-a',
          namespace: 'team-alpha',
          status: 'running',
        }),
      );
      await humanTaskRepo.create(
        buildHumanTask({ id: 'task-pending', processInstanceId: 'inst-a', status: 'pending' }),
      );
      await humanTaskRepo.create(
        buildHumanTask({ id: 'task-claimed', processInstanceId: 'inst-a', status: 'claimed' }),
      );
      await humanTaskRepo.create(
        buildHumanTask({ id: 'task-completed', processInstanceId: 'inst-a', status: 'completed' }),
      );
      const scope = createTestScope({
        instanceRepo,
        auditRepo,
        humanTaskRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      await cancelRun({ runId: 'inst-a' }, scope);

      const pending = await humanTaskRepo.getById('task-pending');
      const claimed = await humanTaskRepo.getById('task-claimed');
      const completed = await humanTaskRepo.getById('task-completed');
      expect(pending!.status).toBe('cancelled');
      expect(claimed!.status).toBe('cancelled');
      expect(completed!.status).toBe('completed');
    });

    it('records cancelled task count in audit outputSnapshot', async () => {
      await instanceRepo.create(
        buildProcessInstance({
          id: 'inst-a',
          namespace: 'team-alpha',
          status: 'running',
        }),
      );
      await humanTaskRepo.create(
        buildHumanTask({ id: 'task-1', processInstanceId: 'inst-a', status: 'pending' }),
      );
      await humanTaskRepo.create(
        buildHumanTask({ id: 'task-2', processInstanceId: 'inst-a', status: 'pending' }),
      );
      const scope = createTestScope({
        instanceRepo,
        auditRepo,
        humanTaskRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      await cancelRun({ runId: 'inst-a' }, scope);

      const events = await auditRepo.getByProcess('inst-a');
      expect(events[0]!.outputSnapshot).toMatchObject({ cancelledTasks: 2 });
    });
  });
});
