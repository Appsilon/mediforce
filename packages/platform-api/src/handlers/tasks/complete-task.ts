import type {
  AuditRepository,
  HumanTaskRepository,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';
import type {
  CompleteTaskInput,
  CompleteTaskOutput,
} from '../../contract/tasks.js';
import { ConflictError, NotFoundError } from '../../errors.js';

/**
 * Opaque side-channel for firing the auto-runner after a task finishes.
 * Production wiring does a fire-and-forget `POST /api/processes/:id/run`
 * (still Phase 3 to migrate); tests pass a recorder to assert the call.
 * Kept as an optional dep so handler tests that don't care can omit it.
 */
export type TriggerRun = (instanceId: string, actorId: string) => void;

/**
 * Minimal subset of `WorkflowEngine` that task mutations consume. Declared
 * structurally here (rather than `Pick<WorkflowEngine, 'advanceStep'>`) so
 * handler tests can pass a `vi.fn()` double without carrying the full
 * `WorkflowEngine.advanceStep` overload shape through the type system.
 */
export interface EngineLike {
  advanceStep(
    instanceId: string,
    stepOutput: Record<string, unknown>,
    actor: { id: string; role: string },
    ...rest: unknown[]
  ): Promise<unknown>;
}

export interface CompleteTaskDeps {
  humanTaskRepo: HumanTaskRepository;
  instanceRepo: ProcessInstanceRepository;
  auditRepo: AuditRepository;
  engine: EngineLike;
  triggerRun?: TriggerRun;
}

/**
 * Pure handler: mark a claimed task complete, resume its paused instance,
 * advance the engine one step, and (optionally) kick the auto-runner.
 *
 * Preconditions:
 *   - Task must exist and be in `claimed` status → else 404 / 409.
 *   - Instance referenced by the task must exist and be `paused` → else 404 / 409.
 */
export async function completeTask(
  input: CompleteTaskInput,
  deps: CompleteTaskDeps,
): Promise<CompleteTaskOutput> {
  const { taskId, verdict } = input;
  const comment = input.comment ?? '';

  const task = await deps.humanTaskRepo.getById(taskId);
  if (task === null) {
    throw new NotFoundError(`Task ${taskId} not found`);
  }
  if (task.status !== 'claimed') {
    throw new ConflictError(
      `Cannot complete a ${task.status} task — must be claimed first`,
    );
  }

  const actorId = task.assignedUserId ?? 'api-user';
  const now = new Date().toISOString();
  const completionData = {
    verdict,
    comment,
    completedBy: actorId,
    completedAt: now,
  };

  await deps.humanTaskRepo.complete(taskId, completionData);

  await deps.auditRepo.append({
    actorId,
    actorType: 'user',
    actorRole: 'operator',
    action: 'task.completed',
    description: `Task '${taskId}' completed with verdict '${verdict}' for step '${task.stepId}'`,
    timestamp: now,
    inputSnapshot: { taskId, verdict, comment, stepId: task.stepId },
    outputSnapshot: { status: 'completed', completionData },
    basis: 'User submitted verdict via API',
    entityType: 'humanTask',
    entityId: taskId,
    processInstanceId: task.processInstanceId,
  });

  const instance = await deps.instanceRepo.getById(task.processInstanceId);
  if (instance === null) {
    throw new NotFoundError(
      `Process instance '${task.processInstanceId}' not found`,
    );
  }
  if (instance.status !== 'paused') {
    throw new ConflictError(
      `Process instance is '${instance.status}', expected 'paused'`,
    );
  }

  await deps.instanceRepo.update(task.processInstanceId, {
    status: 'running',
    pauseReason: null,
    updatedAt: now,
  });

  // Include agent output for L3 review tasks so downstream steps see what was reviewed.
  const stepOutput: Record<string, unknown> = { verdict, comment, taskId };
  const agentReviewData = task.completionData as Record<string, unknown> | null;
  if (agentReviewData?.reviewType === 'agent_output_review') {
    const agentOutput = agentReviewData.agentOutput as
      | Record<string, unknown>
      | undefined;
    if (agentOutput?.result !== undefined) {
      stepOutput.agentOutput = agentOutput.result;
    }
  }

  await deps.engine.advanceStep(task.processInstanceId, stepOutput, {
    id: actorId,
    role: 'human',
  });

  await deps.auditRepo.append({
    actorId,
    actorType: 'user',
    actorRole: 'operator',
    action: 'process.resumed_after_task',
    description: `Process '${task.processInstanceId}' resumed after task verdict '${verdict}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: {
      taskId,
      verdict,
      processInstanceId: task.processInstanceId,
    },
    outputSnapshot: {},
    basis: 'Task completion via API triggered process advancement',
    entityType: 'processInstance',
    entityId: task.processInstanceId,
    processInstanceId: task.processInstanceId,
  });

  if (deps.triggerRun !== undefined) {
    deps.triggerRun(task.processInstanceId, actorId);
  }

  return {
    ok: true,
    taskId,
    verdict,
    processInstanceId: task.processInstanceId,
  };
}
