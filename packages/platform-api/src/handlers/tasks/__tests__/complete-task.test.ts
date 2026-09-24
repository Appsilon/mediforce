import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryAgentRunRepository,
  InMemoryAuditRepository,
  InMemoryHumanTaskRepository,
  InMemoryProcessInstanceRepository,
  InMemoryScoreRepository,
  buildAgentRun,
  buildHumanTask,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import type { HumanTask, ProcessInstance, CompleteHumanTaskPayload, Score } from '@mediforce/platform-core';
import { completeTask } from '../complete-task';
import { ForbiddenError, NotFoundError, PreconditionFailedError } from '../../../errors';
import {
  createTestScope,
  processRepoForFixtureRuns,
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
  let processRepo: Awaited<ReturnType<typeof processRepoForFixtureRuns>>;

  beforeEach(async () => {
    resetFactorySequence();
    processRepo = await processRepoForFixtureRuns(['team-alpha']);
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
      processRepo,
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
      processRepo,
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

  it('accepts verdict-with-params payload and passes it through to the engine', async () => {
    const task = buildHumanTask({
      id: 'task-2',
      processInstanceId: 'inst-a',
      stepId: 'collect-and-decide',
      status: 'claimed',
      assignedUserId: 'u-1',
    });
    await humanTaskRepo.create(task);

    const taskAfter = { ...task, status: 'completed' as const };
    const instanceAfter = (await instanceRepo.getById('inst-a'))!;
    const engineStub = makeEngineStub({ task: taskAfter, instance: instanceAfter });

    const scope = createTestScope({
      humanTaskRepo,
      processRepo,
      instanceRepo,
      auditRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    Object.assign(scope.system, { engine: engineStub });

    const payload: CompleteHumanTaskPayload = {
      kind: 'verdict-with-params',
      verdict: 'approve',
      paramValues: { dose: '10mg', route: 'oral' },
      comment: 'within range',
    };

    const result = await completeTask({ taskId: 'task-2', payload }, scope);

    expect(result.task.status).toBe('completed');
    expect(engineStub.calls[0].payload).toEqual(payload);
  });

  it('rejects a user completing a task claimed by another user', async () => {
    const task = buildHumanTask({
      id: 'task-1',
      processInstanceId: 'inst-a',
      stepId: 'review',
      status: 'claimed',
      assignedUserId: 'u-owner',
    });
    await humanTaskRepo.create(task);

    const engineStub = makeEngineStub({
      task,
      instance: (await instanceRepo.getById('inst-a'))!,
    });
    const scope = createTestScope({
      humanTaskRepo,
      processRepo,
      instanceRepo,
      auditRepo,
      caller: userCaller('u-intruder', ['team-alpha']),
    });
    Object.assign(scope.system, { engine: engineStub });

    await expect(
      completeTask(
        { taskId: 'task-1', payload: { kind: 'verdict', verdict: 'approve' } },
        scope,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(engineStub.calls).toHaveLength(0);
  });

  it('lets an apiKey caller complete a claimed task (CLI / agent acting on behalf)', async () => {
    const task = buildHumanTask({
      id: 'task-1',
      processInstanceId: 'inst-a',
      stepId: 'review',
      status: 'claimed',
      assignedUserId: 'u-owner',
    });
    await humanTaskRepo.create(task);

    const taskAfter = { ...task, status: 'completed' as const };
    const engineStub = makeEngineStub({
      task: taskAfter,
      instance: (await instanceRepo.getById('inst-a'))!,
    });
    const scope = createTestScope({
      humanTaskRepo,
      processRepo,
      instanceRepo,
      auditRepo,
    });
    Object.assign(scope.system, { engine: engineStub });

    const result = await completeTask(
      { taskId: 'task-1', payload: { kind: 'verdict', verdict: 'approve' } },
      scope,
    );
    expect(result.task.status).toBe('completed');
    // apiKey actor attribution falls back to the claimant for the audit trail.
    expect(engineStub.calls[0].actorId).toBe('u-owner');
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
      processRepo,
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

describe('completeTask human_verdict Score (ADR-0023 D13)', () => {
  const AGENT_RUN_ID = '3d7e0c4a-5b1f-4e2a-8c9d-0a1b2c3d4e5f';
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;
  let agentRunRepo: InMemoryAgentRunRepository;
  let scoreRepo: InMemoryScoreRepository;
  let processRepo: Awaited<ReturnType<typeof processRepoForFixtureRuns>>;

  beforeEach(async () => {
    resetFactorySequence();
    processRepo = await processRepoForFixtureRuns(['team-alpha']);
    instanceRepo = new InMemoryProcessInstanceRepository();
    humanTaskRepo = new InMemoryHumanTaskRepository(instanceRepo);
    auditRepo = new InMemoryAuditRepository(instanceRepo);
    agentRunRepo = new InMemoryAgentRunRepository(instanceRepo);
    scoreRepo = new InMemoryScoreRepository();
    await instanceRepo.create(buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha' }));
  });

  async function complete(task: HumanTask, payload: CompleteHumanTaskPayload) {
    await humanTaskRepo.create(task);
    const scope = createTestScope({
      humanTaskRepo, processRepo, instanceRepo, auditRepo, agentRunRepo, scoreRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    const instance = (await instanceRepo.getById('inst-a'))!;
    Object.assign(scope.system, {
      engine: makeEngineStub({ task: { ...task, status: 'completed' as const }, instance }),
    });
    return completeTask({ taskId: task.id, payload }, scope);
  }

  function reviewTask(overrides: Partial<HumanTask> = {}): HumanTask {
    return buildHumanTask({
      id: 'review-1',
      processInstanceId: 'inst-a',
      stepId: 'grade-aes',
      status: 'claimed',
      assignedUserId: 'u-1',
      creationReason: 'agent_review_l3',
      completionData: {
        reviewType: 'agent_output_review',
        agentOutput: { result: { grade: 3 }, agentRunId: AGENT_RUN_ID },
      },
      ...overrides,
    });
  }

  it('records the verdict on the reviewed Agent Run, with an audit event', async () => {
    await complete(reviewTask(), { kind: 'verdict', verdict: 'approve', comment: ' CTCAE grade confirmed ' });

    const [score] = await scoreRepo.list({ limit: 10 });
    expect(score).toMatchObject({
      subject: { type: 'agent_run', id: AGENT_RUN_ID },
      name: 'human_verdict',
      value: 1,
      label: 'approve',
      comment: 'CTCAE grade confirmed',
      source: 'human',
      createdBy: 'u-1',
      namespace: 'team-alpha',
      processInstanceId: 'inst-a',
      stepId: 'grade-aes',
      metadata: { verdictKey: 'approve', intent: 'success', taskId: 'review-1' },
    });
    const scoreAudit = (await auditRepo.getByProcess('inst-a')).find((event) => event.action === 'score.created');
    expect(scoreAudit).toMatchObject({ actorId: 'u-1', actorType: 'user', entityType: 'score', entityId: score!.id });
  });

  it('still completes the task when the Score write fails, logging the failure', async () => {
    class FailingScoreRepository extends InMemoryScoreRepository {
      override async create(): Promise<Score> {
        throw new Error('connection reset');
      }
    }
    scoreRepo = new FailingScoreRepository();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await complete(reviewTask(), { kind: 'verdict', verdict: 'approve' });

    expect(result.task.status).toBe('completed');
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("human_verdict Score not recorded for task 'review-1'"),
      expect.any(Error),
    );
    const actions = (await auditRepo.getByProcess('inst-a')).map((event) => event.action);
    expect(actions).toContain('task.completed');
    expect(actions).not.toContain('score.created');
    consoleError.mockRestore();
  });

  it('records nothing for a task that is not a CM3 review', async () => {
    await complete(
      reviewTask({ creationReason: 'human_executor', completionData: null }),
      { kind: 'verdict', verdict: 'approve' },
    );

    expect(await scoreRepo.list({ limit: 10 })).toEqual([]);
  });
});

