import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  InMemoryHumanTaskRepository,
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  buildHumanTask,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { resolveTask } from '../resolve-task.js';
import type { EngineLike } from '../complete-task.js';
import {
  ConflictError,
  HandlerError,
  NotFoundError,
  ValidationError,
} from '../../../errors.js';

type AdvanceStepFn = EngineLike['advanceStep'];

describe('resolveTask handler', () => {
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;
  let advanceStep: ReturnType<typeof vi.fn<AdvanceStepFn>>;

  beforeEach(() => {
    resetFactorySequence();
    humanTaskRepo = new InMemoryHumanTaskRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository();
    advanceStep = vi.fn<AdvanceStepFn>().mockResolvedValue(undefined);
  });

  const deps = () => ({
    humanTaskRepo,
    instanceRepo,
    auditRepo,
    engine: { advanceStep },
  });

  async function seedTaskAndInstance(
    overrides: Partial<Parameters<typeof buildHumanTask>[0]> = {},
  ): Promise<void> {
    await humanTaskRepo.create(
      buildHumanTask({
        id: 'task-1',
        processInstanceId: 'inst-a',
        assignedUserId: 'alice',
        status: 'claimed',
        ...overrides,
      }),
    );
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-a', status: 'paused', currentStepId: 'next-step' }),
    );
  }

  it('resolves a verdict task and advances the engine', async () => {
    await seedTaskAndInstance();

    const result = await resolveTask(
      { taskId: 'task-1', verdict: 'approve', comment: 'looks good' },
      deps(),
    );

    expect(result.ok).toBe(true);
    expect(result.resolvedStepId).toBe('step-review');
    expect(advanceStep).toHaveBeenCalledTimes(1);
  });

  it('auto-claims a pending task as api-user before resolving', async () => {
    await seedTaskAndInstance({ status: 'pending', assignedUserId: null });

    const result = await resolveTask(
      { taskId: 'task-1', verdict: 'approve' },
      deps(),
    );

    expect(result.ok).toBe(true);
    const events = auditRepo.getAll();
    expect(events.some((e) => e.actorId === 'api-user')).toBe(true);
  });

  it('throws ConflictError when task is already completed', async () => {
    await seedTaskAndInstance({ status: 'completed' });

    await expect(
      resolveTask({ taskId: 'task-1', verdict: 'approve' }, deps()),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('throws ValidationError when verdict is missing for a verdict task', async () => {
    await seedTaskAndInstance();

    await expect(
      resolveTask({ taskId: 'task-1' }, deps()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('supports paramValues tasks', async () => {
    await seedTaskAndInstance({
      params: [{ name: 'dose', type: 'number', required: true }],
    });

    const result = await resolveTask(
      { taskId: 'task-1', paramValues: { dose: 12 } },
      deps(),
    );

    expect(result.ok).toBe(true);
    expect(advanceStep).toHaveBeenCalledWith(
      'inst-a',
      expect.objectContaining({ dose: 12 }),
      expect.any(Object),
    );
  });

  it('supports file-upload tasks', async () => {
    await seedTaskAndInstance({
      ui: { component: 'file-upload' },
    });

    const result = await resolveTask(
      {
        taskId: 'task-1',
        attachments: [{ name: 'doc.pdf', size: 123, type: 'application/pdf' }],
      },
      deps(),
    );

    expect(result.ok).toBe(true);
  });

  it('throws ValidationError when file-upload attachments missing', async () => {
    await seedTaskAndInstance({ ui: { component: 'file-upload' } });

    await expect(
      resolveTask({ taskId: 'task-1' }, deps()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('skips advanceStep for L3 revise verdict', async () => {
    await seedTaskAndInstance({
      creationReason: 'agent_review_l3',
      completionData: {
        reviewType: 'agent_output_review',
        agentOutput: { result: { foo: 'bar' } },
      },
    });

    await resolveTask({ taskId: 'task-1', verdict: 'revise' }, deps());

    expect(advanceStep).not.toHaveBeenCalled();
  });

  it('throws 422 HandlerError when approving an L3 review with empty agent output', async () => {
    await seedTaskAndInstance({
      creationReason: 'agent_review_l3',
      completionData: {
        reviewType: 'agent_output_review',
        agentOutput: { result: {} },
      },
    });

    const err = await resolveTask(
      { taskId: 'task-1', verdict: 'approve' },
      deps(),
    ).catch((e) => e);

    expect(err).toBeInstanceOf(HandlerError);
    expect((err as HandlerError).statusCode).toBe(422);
  });

  it('throws NotFoundError when task does not exist', async () => {
    await expect(
      resolveTask({ taskId: 'missing', verdict: 'approve' }, deps()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('calls triggerRun when provided', async () => {
    await seedTaskAndInstance();
    const triggerRun = vi.fn();

    await resolveTask(
      { taskId: 'task-1', verdict: 'approve' },
      { ...deps(), triggerRun },
    );

    expect(triggerRun).toHaveBeenCalledWith('inst-a', 'alice');
  });
});
