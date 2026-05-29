import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryCoworkSessionRepository,
  InMemoryProcessInstanceRepository,
  buildCoworkSession,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import type { ProcessInstance } from '@mediforce/platform-core';
import { finalizeCoworkSession } from '../finalize';
import { NotFoundError, PreconditionFailedError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import { noopRunKicker } from '../../../runtime/run-kicker';

interface AdvanceStepCall {
  readonly instanceId: string;
  readonly stepOutput: Record<string, unknown>;
  readonly actorId: string;
}

function makeEngineStub(opts: {
  instanceRepo: InMemoryProcessInstanceRepository;
  resultStepId: string;
}) {
  const calls: AdvanceStepCall[] = [];
  return {
    calls,
    async advanceStep(
      instanceId: string,
      stepOutput: Record<string, unknown>,
      actor: { id: string; role: string },
    ): Promise<ProcessInstance> {
      calls.push({ instanceId, stepOutput, actorId: actor.id });
      const inst = await opts.instanceRepo.getById(instanceId);
      if (!inst) throw new Error('instance disappeared');
      const next: ProcessInstance = { ...inst, currentStepId: opts.resultStepId };
      await opts.instanceRepo.update(instanceId, { currentStepId: opts.resultStepId });
      return next;
    },
  };
}

describe('finalizeCoworkSession handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let coworkSessionRepo: InMemoryCoworkSessionRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    coworkSessionRepo = new InMemoryCoworkSessionRepository(instanceRepo);
    auditRepo = new InMemoryAuditRepository(instanceRepo);
  });

  it('finalizes the session, emits audit, resumes the instance, advances, and kicks', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-a',
        namespace: 'team-alpha',
        status: 'paused',
        pauseReason: 'awaiting-cowork',
        definitionVersion: '3',
      }),
    );
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-1',
        processInstanceId: 'inst-a',
        stepId: 'draft',
        status: 'active',
      }),
    );

    const kicker = noopRunKicker();
    const scope = createTestScope({
      instanceRepo,
      coworkSessionRepo,
      auditRepo,
      runKicker: kicker,
      caller: userCaller('u-1', ['team-alpha']),
    });
    const engine = makeEngineStub({ instanceRepo, resultStepId: 'review' });
    Object.assign(scope.system, { engine });

    const artifact = { title: 'Plan A', items: [1, 2, 3] };
    const result = await finalizeCoworkSession(
      { sessionId: 'sess-1', artifact },
      scope,
    );

    expect(result).toEqual({
      sessionId: 'sess-1',
      resolvedStepId: 'draft',
      processInstanceId: 'inst-a',
      nextStepId: 'review',
      status: 'running',
    });

    const finalSession = await coworkSessionRepo.getById('sess-1');
    expect(finalSession?.status).toBe('finalized');
    expect(finalSession?.artifact).toEqual(artifact);

    const updatedInstance = await instanceRepo.getById('inst-a');
    expect(updatedInstance?.status).toBe('running');
    expect(updatedInstance?.pauseReason).toBeNull();

    expect(engine.calls).toEqual([
      { instanceId: 'inst-a', stepOutput: artifact, actorId: 'u-1' },
    ]);

    expect(kicker.kicks).toEqual([
      { instanceId: 'inst-a', triggeredBy: 'u-1' },
    ]);

    const events = await auditRepo.getByProcess('inst-a');
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.action).toBe('cowork.session.finalized');
    expect(event.actorId).toBe('u-1');
    expect(event.entityType).toBe('coworkSession');
    expect(event.entityId).toBe('sess-1');
    expect(event.processInstanceId).toBe('inst-a');
    expect(event.outputSnapshot).toEqual({ artifactKeys: ['title', 'items'] });
  });

  it('throws PreconditionFailedError when session already finalized', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha', status: 'paused' }),
    );
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-1',
        processInstanceId: 'inst-a',
        status: 'finalized',
      }),
    );

    const scope = createTestScope({
      instanceRepo,
      coworkSessionRepo,
      auditRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    Object.assign(scope.system, {
      engine: makeEngineStub({ instanceRepo, resultStepId: 'x' }),
    });

    await expect(
      finalizeCoworkSession({ sessionId: 'sess-1', artifact: { a: 1 } }, scope),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
  });

  it('throws PreconditionFailedError when instance is not paused', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha', status: 'running' }),
    );
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-1',
        processInstanceId: 'inst-a',
        status: 'active',
      }),
    );

    const scope = createTestScope({
      instanceRepo,
      coworkSessionRepo,
      auditRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    Object.assign(scope.system, {
      engine: makeEngineStub({ instanceRepo, resultStepId: 'x' }),
    });

    await expect(
      finalizeCoworkSession({ sessionId: 'sess-1', artifact: { a: 1 } }, scope),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
  });

  it('throws NotFoundError when the session does not exist', async () => {
    const scope = createTestScope({
      instanceRepo,
      coworkSessionRepo,
      auditRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    Object.assign(scope.system, {
      engine: makeEngineStub({ instanceRepo, resultStepId: 'x' }),
    });

    await expect(
      finalizeCoworkSession({ sessionId: 'sess-missing', artifact: {} }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError for cross-namespace caller (anti-enum)', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha', status: 'paused' }),
    );
    await coworkSessionRepo.create(
      buildCoworkSession({
        id: 'sess-1',
        processInstanceId: 'inst-a',
        status: 'active',
      }),
    );

    const scope = createTestScope({
      instanceRepo,
      coworkSessionRepo,
      auditRepo,
      caller: userCaller('u-2', ['team-beta']),
    });
    Object.assign(scope.system, {
      engine: makeEngineStub({ instanceRepo, resultStepId: 'x' }),
    });

    await expect(
      finalizeCoworkSession({ sessionId: 'sess-1', artifact: {} }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
