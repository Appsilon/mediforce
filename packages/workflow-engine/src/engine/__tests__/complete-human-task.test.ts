import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryProcessRepository,
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
  InMemoryHumanTaskRepository,
  buildHumanTask,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core';
import type { HumanTask, ProcessInstance, WorkflowDefinition } from '@mediforce/platform-core';
import { WorkflowEngine, InvalidTransitionError, CompleteHumanTaskValidationError } from '../../index';

/**
 * Integration coverage for `WorkflowEngine.completeHumanTask` — the
 * orchestration that was lifted out of the platform-api `lib/resolve-task`
 * handler in the ADR-0005 Phase 3 headless-API migration. Pure helpers are
 * covered in `complete-human-task-helpers.test.ts`; here we wire a real
 * engine to in-memory repos and exercise the full path:
 *
 *   load → status guards → auto-claim → shapeCompletion → complete →
 *   resume instance → conditional advanceStep → L3-revise branch.
 */

const REVIEW_THEN_DONE: WorkflowDefinition = {
  name: 'review-then-done',
  version: 1,
  namespace: 'test',
  visibility: 'private',
  steps: [
    { id: 'review', name: 'Review', type: 'review', executor: 'human' },
    { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
  ],
  transitions: [{ from: 'review', to: 'done' }],
  triggers: [{ type: 'manual', name: 'Start' }],
};

const PARAMS_THEN_DONE: WorkflowDefinition = {
  name: 'params-then-done',
  version: 1,
  namespace: 'test',
  visibility: 'private',
  steps: [
    { id: 'collect', name: 'Collect', type: 'creation', executor: 'human' },
    { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
  ],
  transitions: [{ from: 'collect', to: 'done' }],
  triggers: [{ type: 'manual', name: 'Start' }],
};

function pausedReviewInstance(overrides: Partial<ProcessInstance> = {}): ProcessInstance {
  return buildProcessInstance({
    definitionName: 'review-then-done',
    definitionVersion: '1',
    namespace: 'test',
    status: 'paused',
    pauseReason: 'waiting_for_human',
    currentStepId: 'review',
    ...overrides,
  });
}

describe('WorkflowEngine.completeHumanTask', () => {
  let processRepo: InMemoryProcessRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let engine: WorkflowEngine;

  beforeEach(async () => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository();
    humanTaskRepo = new InMemoryHumanTaskRepository(instanceRepo);
    engine = new WorkflowEngine(processRepo, instanceRepo, auditRepo, undefined, undefined, undefined, humanTaskRepo);

    await processRepo.saveWorkflowDefinition(REVIEW_THEN_DONE);
    await processRepo.saveWorkflowDefinition(PARAMS_THEN_DONE);
  });

  it('verdict happy path: completes task, resumes instance, advances to terminal', async () => {
    const instance = pausedReviewInstance();
    await instanceRepo.create(instance);

    const task = buildHumanTask({
      processInstanceId: instance.id,
      stepId: 'review',
      status: 'claimed',
      assignedUserId: 'u-1',
      creationReason: 'human_executor',
    });
    await humanTaskRepo.create(task);

    const result = await engine.completeHumanTask(task.id, { kind: 'verdict', verdict: 'approve' }, 'u-1');

    expect(result.isL3Revise).toBe(false);
    expect(result.resolvedStepId).toBe('review');
    expect(result.stepOutput.verdict).toBe('approve');

    const storedTask = await humanTaskRepo.getById(task.id);
    expect(storedTask?.status).toBe('completed');
    expect(storedTask?.completionData?.completedBy).toBe('u-1');

    const storedInstance = await instanceRepo.getById(instance.id);
    expect(storedInstance?.status).toBe('completed');
    expect(storedInstance?.pauseReason).toBeNull();
  });

  it('params variant: auto-claims a pending task and uses paramValues as stepOutput', async () => {
    const instance = pausedReviewInstance({
      definitionName: 'params-then-done',
      currentStepId: 'collect',
    });
    await instanceRepo.create(instance);

    const task = buildHumanTask({
      processInstanceId: instance.id,
      stepId: 'collect',
      status: 'pending',
      assignedUserId: null,
      params: [{ name: 'foo', type: 'string', required: false }] as never,
      creationReason: 'human_executor',
    });
    await humanTaskRepo.create(task);

    const result = await engine.completeHumanTask(task.id, { kind: 'params', paramValues: { foo: 'bar' } }, 'u-1');

    expect(result.isL3Revise).toBe(false);
    expect(result.stepOutput).toEqual({ foo: 'bar' });

    const storedTask = await humanTaskRepo.getById(task.id);
    expect(storedTask?.status).toBe('completed');
    expect(storedTask?.assignedUserId).toBe('u-1');
    expect(storedTask?.completionData?.completedBy).toBe('u-1');

    const storedInstance = await instanceRepo.getById(instance.id);
    expect(storedInstance?.status).toBe('completed');
  });

  it('L3-revise: resumes instance but does NOT advance the step', async () => {
    const instance = pausedReviewInstance();
    await instanceRepo.create(instance);

    const task = buildHumanTask({
      processInstanceId: instance.id,
      stepId: 'review',
      status: 'claimed',
      assignedUserId: 'u-1',
      creationReason: 'agent_review_l3',
    });
    await humanTaskRepo.create(task);

    const result = await engine.completeHumanTask(
      task.id,
      { kind: 'verdict', verdict: 'revise', comment: 'redo this' },
      'u-1',
    );

    expect(result.isL3Revise).toBe(true);
    expect(result.resolvedStepId).toBe('review');

    const storedInstance = await instanceRepo.getById(instance.id);
    expect(storedInstance?.status).toBe('running');
    expect(storedInstance?.currentStepId).toBe('review');
    expect(storedInstance?.pauseReason).toBeNull();

    const storedTask = await humanTaskRepo.getById(task.id);
    expect(storedTask?.status).toBe('completed');
    expect(storedTask?.completionData?.verdict).toBe('revise');
  });

  it('rejects with InvalidTransitionError when task is already terminal', async () => {
    const instance = pausedReviewInstance();
    await instanceRepo.create(instance);

    const task = buildHumanTask({
      processInstanceId: instance.id,
      stepId: 'review',
      status: 'completed',
      assignedUserId: 'u-1',
      completedAt: '2026-05-26T00:00:00.000Z',
      completionData: { verdict: 'approve' } as never,
    });
    await humanTaskRepo.create(task);

    await expect(
      engine.completeHumanTask(task.id, { kind: 'verdict', verdict: 'approve' }, 'u-1'),
    ).rejects.toBeInstanceOf(InvalidTransitionError);

    const storedTask = await humanTaskRepo.getById(task.id);
    expect(storedTask?.completionData?.verdict).toBe('approve');
  });

  it('throws when the engine was constructed without a humanTaskRepository', async () => {
    const engineWithoutTasks = new WorkflowEngine(processRepo, instanceRepo, auditRepo);

    await expect(
      engineWithoutTasks.completeHumanTask('any-task', { kind: 'verdict', verdict: 'approve' }, 'u-1'),
    ).rejects.toThrow(/humanTaskRepository/);
  });

  it('surfaces CompleteHumanTaskValidationError from shapeCompletion (verdict not in allowlist)', async () => {
    const instance = pausedReviewInstance();
    await instanceRepo.create(instance);

    const task: HumanTask = buildHumanTask({
      processInstanceId: instance.id,
      stepId: 'review',
      status: 'claimed',
      assignedUserId: 'u-1',
      verdicts: [{ key: 'approve', label: 'Approve', intent: 'success', requiresComment: false }],
    });
    await humanTaskRepo.create(task);

    await expect(
      engine.completeHumanTask(task.id, { kind: 'verdict', verdict: 'revise', comment: 'redo' }, 'u-1'),
    ).rejects.toBeInstanceOf(CompleteHumanTaskValidationError);
  });
});
