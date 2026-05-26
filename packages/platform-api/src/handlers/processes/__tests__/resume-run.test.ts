import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { resumeRun } from '../resume-run.js';
import { NotFoundError, PreconditionFailedError } from '../../../errors.js';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope.js';
import { noopRunKicker } from '../../../runtime/run-kicker.js';

describe('resumeRun handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
  });

  it('transitions a paused run to running, emits instance.resumed, kicks the runner', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-paused',
        namespace: 'team-alpha',
        status: 'paused',
        pauseReason: 'awaiting-human',
        definitionVersion: '2',
      }),
    );
    const kicker = noopRunKicker();
    const scope = createTestScope({
      instanceRepo,
      auditRepo,
      runKicker: kicker,
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await resumeRun({ runId: 'inst-paused' }, scope);

    expect(result.run.id).toBe('inst-paused');
    expect(result.run.status).toBe('running');
    expect(result.run.pauseReason).toBeNull();
    expect(result.run.error).toBeNull();

    const events = await auditRepo.getByProcess('inst-paused');
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.action).toBe('instance.resumed');
    expect(event.actorId).toBe('u-1');
    expect(event.actorType).toBe('user');
    expect(event.entityType).toBe('processInstance');
    expect(event.entityId).toBe('inst-paused');
    expect(event.processInstanceId).toBe('inst-paused');
    expect(event.processDefinitionVersion).toBe('2');
    expect(event.inputSnapshot).toMatchObject({
      previousStatus: 'paused',
      previousPauseReason: 'awaiting-human',
    });
    expect(event.outputSnapshot).toMatchObject({ status: 'running' });
    expect(event.basis).toMatch(/resume/i);

    expect(kicker.kicks).toEqual([
      { instanceId: 'inst-paused', triggeredBy: 'u-1' },
    ]);
  });

  it('transitions a failed run to running (agent-paused recovery path)', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-failed',
        namespace: 'team-alpha',
        status: 'failed',
        error: 'agent died',
      }),
    );
    const kicker = noopRunKicker();
    const scope = createTestScope({
      instanceRepo,
      auditRepo,
      runKicker: kicker,
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await resumeRun({ runId: 'inst-failed' }, scope);

    expect(result.run.status).toBe('running');
    expect(result.run.error).toBeNull();
    expect(kicker.kicks).toHaveLength(1);
    expect(kicker.kicks[0].instanceId).toBe('inst-failed');
  });

  it('throws PreconditionFailedError when the run is already completed', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-done',
        namespace: 'team-alpha',
        status: 'completed',
      }),
    );
    const scope = createTestScope({
      instanceRepo,
      auditRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    const err = await resumeRun({ runId: 'inst-done' }, scope).catch((e) => e);

    expect(err).toBeInstanceOf(PreconditionFailedError);
    expect((err as PreconditionFailedError).code).toBe('precondition_failed');
  });

  it('throws NotFoundError when the instance does not exist', async () => {
    const scope = createTestScope({
      instanceRepo,
      auditRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    await expect(
      resumeRun({ runId: 'inst-missing' }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError for a foreign-workspace instance (anti-enum)', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-foreign',
        namespace: 'team-beta',
        status: 'paused',
      }),
    );
    const scope = createTestScope({
      instanceRepo,
      auditRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    await expect(
      resumeRun({ runId: 'inst-foreign' }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
