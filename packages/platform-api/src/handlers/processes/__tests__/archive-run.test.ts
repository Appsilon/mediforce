import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { archiveRun } from '../archive-run';
import { NotFoundError, PreconditionFailedError } from '../../../errors';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

describe('archiveRun handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
  });

  describe('happy path', () => {
    it('archives a completed run and returns the post-mutation entity', async () => {
      await instanceRepo.create(buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha', status: 'completed' }));
      const scope = createTestScope({
        instanceRepo,
        auditRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      const result = await archiveRun({ runId: 'inst-a', archived: true }, scope);

      expect(result.run.id).toBe('inst-a');
      expect(result.run.archived).toBe(true);
    });

    it('unarchives an archived run', async () => {
      await instanceRepo.create(
        buildProcessInstance({
          id: 'inst-a',
          namespace: 'team-alpha',
          status: 'completed',
          archived: true,
        }),
      );
      const scope = createTestScope({
        instanceRepo,
        auditRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      const result = await archiveRun({ runId: 'inst-a', archived: false }, scope);

      expect(result.run.archived).toBe(false);
    });

    it('archives a failed run', async () => {
      await instanceRepo.create(buildProcessInstance({ id: 'inst-f', namespace: 'team-alpha', status: 'failed' }));
      const scope = createTestScope({
        instanceRepo,
        auditRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      const result = await archiveRun({ runId: 'inst-f', archived: true }, scope);

      expect(result.run.archived).toBe(true);
    });

    it('archives a paused run whose pauseReason is non-active (e.g. missing_env)', async () => {
      await instanceRepo.create(
        buildProcessInstance({
          id: 'inst-p',
          namespace: 'team-alpha',
          status: 'paused',
          pauseReason: 'missing_env',
        }),
      );
      const scope = createTestScope({
        instanceRepo,
        auditRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      const result = await archiveRun({ runId: 'inst-p', archived: true }, scope);

      expect(result.run.archived).toBe(true);
    });
  });

  describe('precondition failures', () => {
    it('throws PreconditionFailedError on a running run', async () => {
      await instanceRepo.create(buildProcessInstance({ id: 'inst-r', namespace: 'team-alpha', status: 'running' }));
      const scope = createTestScope({
        instanceRepo,
        auditRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      const err = await archiveRun({ runId: 'inst-r', archived: true }, scope).catch((e) => e);

      expect(err).toBeInstanceOf(PreconditionFailedError);
      expect((err as PreconditionFailedError).code).toBe('precondition_failed');
    });

    it('throws PreconditionFailedError on a paused waiting-for-human run', async () => {
      await instanceRepo.create(
        buildProcessInstance({
          id: 'inst-w',
          namespace: 'team-alpha',
          status: 'paused',
          pauseReason: 'waiting_for_human',
        }),
      );
      const scope = createTestScope({
        instanceRepo,
        auditRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      const err = await archiveRun({ runId: 'inst-w', archived: true }, scope).catch((e) => e);

      expect(err).toBeInstanceOf(PreconditionFailedError);
    });
  });

  describe('not-found / foreign-workspace', () => {
    it('throws NotFoundError when the instance does not exist', async () => {
      const scope = createTestScope({
        instanceRepo,
        auditRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      const err = await archiveRun({ runId: 'missing', archived: true }, scope).catch((e) => e);

      expect(err).toBeInstanceOf(NotFoundError);
    });

    it('throws NotFoundError for a foreign-workspace instance', async () => {
      await instanceRepo.create(buildProcessInstance({ id: 'inst-f', namespace: 'team-beta', status: 'completed' }));
      const scope = createTestScope({
        instanceRepo,
        auditRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      const err = await archiveRun({ runId: 'inst-f', archived: true }, scope).catch((e) => e);

      expect(err).toBeInstanceOf(NotFoundError);
    });
  });

  describe('audit emission', () => {
    it('emits instance.archived with actor + snapshots', async () => {
      await instanceRepo.create(
        buildProcessInstance({
          id: 'inst-a',
          namespace: 'team-alpha',
          status: 'completed',
          definitionVersion: '2',
        }),
      );
      const scope = createTestScope({
        instanceRepo,
        auditRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      await archiveRun({ runId: 'inst-a', archived: true }, scope);

      const events = await auditRepo.getByProcess('inst-a');
      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.action).toBe('instance.archived');
      expect(event.actorId).toBe('u-1');
      expect(event.actorType).toBe('user');
      expect(event.entityType).toBe('processInstance');
      expect(event.entityId).toBe('inst-a');
      expect(event.processInstanceId).toBe('inst-a');
      expect(event.processDefinitionVersion).toBe('2');
      expect(event.inputSnapshot).toMatchObject({ previousArchived: false });
      expect(event.outputSnapshot).toMatchObject({ archived: true });
    });

    it('emits instance.unarchived when archived=false', async () => {
      await instanceRepo.create(
        buildProcessInstance({
          id: 'inst-a',
          namespace: 'team-alpha',
          status: 'completed',
          archived: true,
        }),
      );
      const scope = createTestScope({
        instanceRepo,
        auditRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      await archiveRun({ runId: 'inst-a', archived: false }, scope);

      const events = await auditRepo.getByProcess('inst-a');
      expect(events[0]!.action).toBe('instance.unarchived');
      expect(events[0]!.inputSnapshot).toMatchObject({ previousArchived: true });
      expect(events[0]!.outputSnapshot).toMatchObject({ archived: false });
    });

    it('attributes audit to api-user when caller is system actor', async () => {
      await instanceRepo.create(buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha', status: 'completed' }));
      const scope = createTestScope({ instanceRepo, auditRepo });

      await archiveRun({ runId: 'inst-a', archived: true }, scope);

      const events = await auditRepo.getByProcess('inst-a');
      expect(events[0]!.actorId).toBe('api-user');
      expect(events[0]!.actorType).toBe('system');
    });
  });
});
