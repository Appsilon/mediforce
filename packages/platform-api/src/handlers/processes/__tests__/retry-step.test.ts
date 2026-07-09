import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import type { ProcessInstance } from '@mediforce/platform-core';
import { retryStep } from '../retry-step';
import { NotFoundError, PreconditionFailedError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import { noopRunKicker } from '../../../runtime/run-kicker';

/**
 * Handler-level tests for `retryStep`. The engine is stubbed; engine-internal
 * mechanics (variable preservation, `step.retried` emission) belong to
 * `workflow-engine`'s own `retry-step.test.ts`. This file covers the
 * handler-resident bridge: audit emission at the instance level, run kick,
 * error mapping, and workspace gating.
 */

interface EngineStubCall {
  readonly instanceId: string;
  readonly stepId: string;
  readonly actor: { readonly id: string; readonly role: string };
}

function makeEngineStub(opts: {
  readonly result?: ProcessInstance;
  readonly throws?: Error;
}) {
  const calls: EngineStubCall[] = [];
  return {
    calls,
    async retryStep(
      instanceId: string,
      stepId: string,
      actor: { readonly id: string; readonly role: string },
    ): Promise<ProcessInstance> {
      calls.push({ instanceId, stepId, actor });
      if (opts.throws) throw opts.throws;
      if (!opts.result) throw new Error('engine stub missing result');
      return opts.result;
    },
  };
}

describe('retryStep handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(async () => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-a',
        namespace: 'team-alpha',
        status: 'failed',
        currentStepId: 'deploy',
        definitionVersion: '4',
      }),
    );
  });

  it('returns the engine-updated run, emits instance.retried, kicks the runner', async () => {
    const instanceAfter: ProcessInstance = {
      ...(await instanceRepo.getById('inst-a'))!,
      status: 'running',
      error: null,
    };
    const engineStub = makeEngineStub({ result: instanceAfter });
    const kicker = noopRunKicker();
    const scope = createTestScope({
      instanceRepo,
      auditRepo,
      runKicker: kicker,
      caller: userCaller('u-1', ['team-alpha']),
    });
    Object.assign(scope.system, { engine: engineStub });

    const result = await retryStep(
      { runId: 'inst-a', stepId: 'deploy' },
      scope,
    );

    expect(result.run.id).toBe('inst-a');
    expect(result.run.status).toBe('running');

    expect(engineStub.calls).toEqual([
      { instanceId: 'inst-a', stepId: 'deploy', actor: { id: 'u-1', role: 'operator' } },
    ]);

    const events = await auditRepo.getByProcess('inst-a');
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.action).toBe('instance.retried');
    expect(event.actorId).toBe('u-1');
    expect(event.actorType).toBe('user');
    expect(event.entityType).toBe('processInstance');
    expect(event.entityId).toBe('inst-a');
    expect(event.processInstanceId).toBe('inst-a');
    expect(event.processDefinitionVersion).toBe('4');
    expect(event.inputSnapshot).toMatchObject({
      instanceId: 'inst-a',
      stepId: 'deploy',
      previousExecutionId: null,
      previousError: null,
    });

    expect(kicker.kicks).toEqual([
      { instanceId: 'inst-a', triggeredBy: 'u-1' },
    ]);
  });

  it('maps engine InvalidTransitionError to PreconditionFailedError (409)', async () => {
    const { InvalidTransitionError } = await import('@mediforce/workflow-engine');
    const engineStub = makeEngineStub({
      throws: new InvalidTransitionError('completed', 'retryStep'),
    });
    const kicker = noopRunKicker();
    const scope = createTestScope({
      instanceRepo,
      auditRepo,
      runKicker: kicker,
      caller: userCaller('u-1', ['team-alpha']),
    });
    Object.assign(scope.system, { engine: engineStub });

    const err = await retryStep(
      { runId: 'inst-a', stepId: 'deploy' },
      scope,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(PreconditionFailedError);
    expect((err as PreconditionFailedError).code).toBe('precondition_failed');
    // No audit / no kick on failure.
    const events = await auditRepo.getByProcess('inst-a');
    expect(events).toHaveLength(0);
    expect(kicker.kicks).toHaveLength(0);
  });

  it('throws NotFoundError for a foreign-workspace instance (anti-enum)', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-foreign',
        namespace: 'team-beta',
        status: 'failed',
      }),
    );
    const engineStub = makeEngineStub({
      result: (await instanceRepo.getById('inst-foreign'))!,
    });
    const scope = createTestScope({
      instanceRepo,
      auditRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    Object.assign(scope.system, { engine: engineStub });

    await expect(
      retryStep({ runId: 'inst-foreign', stepId: 'deploy' }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Workspace gate trips before engine is invoked.
    expect(engineStub.calls).toHaveLength(0);
  });
});
