import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryHumanTaskRepository,
  InMemoryProcessInstanceRepository,
  buildHumanTask,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import type { HumanTask, ProcessInstance, CompleteHumanTaskPayload } from '@mediforce/platform-core';
import { completeTask } from '../complete-task';
import { NotFoundError, PreconditionFailedError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import { noopRunKicker } from '../../../runtime/run-kicker';

/**
 * Handler-level tests for `completeTask`. The engine is stubbed so this
 * test focuses on the handler-resident bridge (audit emission, kick, error
 * mapping). Per-variant payload validation lives in the engine's own
 * `complete-human-task-helpers.test.ts`; full engine integration lives in
 * `workflow-engine`'s `complete-human-task.test.ts`.
 */

interface EngineStubCall {
  taskId: string;
  payload: CompleteHumanTaskPayload;
  actorId: string;
}

function makeEngineStub(opts: {
  task: HumanTask;
  instance: ProcessInstance;
  isL3Revise?: boolean;
  throws?: Error;
}) {
  const calls: EngineStubCall[] = [];
  const stub = {
    calls,
    async completeHumanTask(
      taskId: string,
      payload: CompleteHumanTaskPayload,
      actorId: string,
    ) {
      calls.push({ taskId, payload, actorId });
      if (opts.throws) throw opts.throws;
      return {
        task: opts.task,
        instance: opts.instance,
        stepOutput: {},
        resolvedStepId: opts.task.stepId,
        isL3Revise: opts.isL3Revise ?? false,
      };
    },
  };
  return stub;
}

describe('completeTask handler', () => {
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(async () => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    humanTaskRepo = new InMemoryHumanTaskRepository(instanceRepo);
    auditRepo = new InMemoryAuditRepository(instanceRepo);
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha' }),
    );
  });

  it('returns updated { task, run }, emits audits, and kicks the run', async () => {
    const taskBefore = buildHumanTask({
      id: 'task-1',
      processInstanceId: 'inst-a',
      stepId: 'review',
      status: 'claimed',
      assignedUserId: 'u-1',
    });
    await humanTaskRepo.create(taskBefore);

    const taskAfter = { ...taskBefore, status: 'completed' as const };
    const instanceAfter = (await instanceRepo.getById('inst-a'))!;
    const engineStub = makeEngineStub({ task: taskAfter, instance: instanceAfter });
    const kicker = noopRunKicker();

    const scope = createTestScope({
      humanTaskRepo,
      instanceRepo,
      auditRepo,
      runKicker: kicker,
      caller: userCaller('u-1', ['team-alpha']),
    });
    Object.assign(scope.system, { engine: engineStub });

    const result = await completeTask(
      {
        taskId: 'task-1',
        payload: { kind: 'verdict', verdict: 'approve', comment: 'ok' },
      },
      scope,
    );

    expect(result.task.status).toBe('completed');
    expect(result.run.id).toBe('inst-a');

    const events = await auditRepo.getByProcess('inst-a');
    const actions = events.map((e) => e.action);
    expect(actions).toContain('task.completed');
    expect(actions).toContain('process.resumed_after_task');

    expect(kicker.kicks).toEqual([
      { instanceId: 'inst-a', triggeredBy: 'u-1' },
    ]);
    expect(engineStub.calls[0].actorId).toBe('u-1');
  });

  it('returns 404 when the task is outside the caller workspace', async () => {
    const task = buildHumanTask({
      id: 'task-1',
      processInstanceId: 'inst-a',
      status: 'claimed',
    });
    await humanTaskRepo.create(task);

    const scope = createTestScope({
      humanTaskRepo,
      instanceRepo,
      auditRepo,
      caller: userCaller('u-1', ['team-other']),
    });
    Object.assign(scope.system, { engine: makeEngineStub({ task, instance: (await instanceRepo.getById('inst-a'))! }) });

    await expect(
      completeTask(
        { taskId: 'task-1', payload: { kind: 'verdict', verdict: 'approve' } },
        scope,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('maps engine InvalidTransitionError to PreconditionFailedError (409)', async () => {
    const task = buildHumanTask({ id: 'task-1', processInstanceId: 'inst-a', status: 'claimed' });
    await humanTaskRepo.create(task);
    const { InvalidTransitionError } = await import('@mediforce/workflow-engine');

    const engineStub = makeEngineStub({
      task,
      instance: (await instanceRepo.getById('inst-a'))!,
      throws: new InvalidTransitionError('completed', 'completeHumanTask'),
    });
    const scope = createTestScope({
      humanTaskRepo,
      instanceRepo,
      auditRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    Object.assign(scope.system, { engine: engineStub });

    await expect(
      completeTask(
        { taskId: 'task-1', payload: { kind: 'verdict', verdict: 'approve' } },
        scope,
      ),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
  });
});
