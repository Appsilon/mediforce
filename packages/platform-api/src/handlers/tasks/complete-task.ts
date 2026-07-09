import {
  InvalidTransitionError,
  CompleteHumanTaskValidationError,
  ParentInstanceNotFoundError,
} from '@mediforce/workflow-engine';
import type {
  CompleteHumanTaskPayload,
  HumanTask,
  ProcessInstance,
} from '@mediforce/platform-core';
import type { CompleteTaskInput, CompleteTaskOutput } from '../../contract/tasks';
import type { CallerScope } from '../../repositories/index';
import {
  ForbiddenError,
  HandlerError,
  NotFoundError,
  PreconditionFailedError,
} from '../../errors';
import { actorFromCaller, loadOr404 } from '../_helpers';

export async function completeTask(
  input: CompleteTaskInput,
  scope: CallerScope,
): Promise<CompleteTaskOutput> {
  const ctx = await loadTaskContext(scope, input.taskId);
  const result = await runEngineCompletion(scope, input, ctx.actorId);
  await emitAuditEvents(scope, input, result, ctx);
  await scope.system.runKicker.kick(result.task.processInstanceId, {
    triggeredBy: ctx.actorId,
  });
  return { task: result.task, run: result.instance };
}

interface TaskContext {
  readonly task: HumanTask;
  readonly actor: ReturnType<typeof actorFromCaller>;
  readonly actorId: string;
}

async function loadTaskContext(
  scope: CallerScope,
  taskId: string,
): Promise<TaskContext> {
  const task = await loadOr404(scope.tasks.getById(taskId), 'Task not found');
  if (
    scope.caller.kind === 'user' &&
    task.assignedUserId !== null &&
    task.assignedUserId !== scope.caller.uid
  ) {
    throw new ForbiddenError('Task is claimed by another user');
  }
  const actor = actorFromCaller(scope);
  // Fall back to the task's prior assignee for apiKey callers so the audit
  // trail reflects the human who claimed the task, not 'api-user'.
  const actorId = scope.caller.kind === 'user'
    ? actor.actorId
    : task.assignedUserId ?? actor.actorId;
  return { task, actor, actorId };
}

interface EngineResult {
  readonly task: HumanTask;
  readonly instance: ProcessInstance;
  readonly resolvedStepId: string;
}

async function runEngineCompletion(
  scope: CallerScope,
  input: CompleteTaskInput,
  actorId: string,
): Promise<EngineResult> {
  try {
    return await scope.system.engine.completeHumanTask(
      input.taskId,
      input.payload,
      actorId,
    );
  } catch (err) {
    if (err instanceof CompleteHumanTaskValidationError) {
      throw new HandlerError('validation', err.message, err.details);
    }
    if (err instanceof InvalidTransitionError) {
      throw new PreconditionFailedError(err.message, {
        fromStatus: err.fromStatus,
        operation: err.operation,
      });
    }
    if (err instanceof ParentInstanceNotFoundError) {
      throw new NotFoundError(err.message);
    }
    throw err;
  }
}

async function emitAuditEvents(
  scope: CallerScope,
  input: CompleteTaskInput,
  result: EngineResult,
  ctx: TaskContext,
): Promise<void> {
  const auditActor = { ...ctx.actor, actorId: ctx.actorId };
  const { task: updatedTask, resolvedStepId } = result;
  const now = new Date().toISOString();
  const completionData =
    (updatedTask.completionData as Record<string, unknown> | null) ?? {};
  const { description, inputSnapshot } = auditFieldsFor(
    input.payload,
    input.taskId,
    resolvedStepId,
  );

  await scope.system.audit.append({
    ...auditActor,
    action: 'task.completed',
    description,
    timestamp: now,
    inputSnapshot,
    outputSnapshot: { status: 'completed', completionData },
    basis: 'Task resolved via API',
    entityType: 'humanTask',
    entityId: input.taskId,
    processInstanceId: updatedTask.processInstanceId,
  });

  await scope.system.audit.append({
    ...auditActor,
    action: 'process.resumed_after_task',
    description: `Process '${updatedTask.processInstanceId}' resumed after resolving step '${resolvedStepId}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: {
      taskId: input.taskId,
      processInstanceId: updatedTask.processInstanceId,
      stepId: resolvedStepId,
    },
    outputSnapshot: {},
    basis: 'Task resolution triggered process advancement',
    entityType: 'processInstance',
    entityId: updatedTask.processInstanceId,
    processInstanceId: updatedTask.processInstanceId,
  });
}

interface AuditFields {
  readonly description: string;
  readonly inputSnapshot: Record<string, unknown>;
}

function auditFieldsFor(
  payload: CompleteHumanTaskPayload,
  taskId: string,
  stepId: string,
): AuditFields {
  const head = `Task '${taskId}' resolved`;
  switch (payload.kind) {
    case 'upload':
      return {
        description: `${head} with ${payload.attachments.length} file(s) for step '${stepId}'`,
        inputSnapshot: { taskId, stepId, fileCount: payload.attachments.length },
      };
    case 'assignment':
      return {
        description: `${head} with ${payload.assignments.length} assignment(s) for step '${stepId}'`,
        inputSnapshot: { taskId, stepId, assignmentCount: payload.assignments.length },
      };
    case 'rows':
      return {
        description: `${head} with ${payload.rows.length} row(s) for step '${stepId}'`,
        inputSnapshot: { taskId, stepId, rowCount: payload.rows.length },
      };
    case 'params':
      return {
        description: `${head} with param values for step '${stepId}'`,
        inputSnapshot: { taskId, stepId, paramKeys: Object.keys(payload.paramValues) },
      };
    case 'verdict':
      return {
        description: `${head} with verdict '${payload.verdict}' for step '${stepId}'`,
        inputSnapshot: { taskId, stepId, verdict: payload.verdict },
      };
    case 'verdict-with-params':
      return {
        description: `${head} with verdict '${payload.verdict}' and param values for step '${stepId}'`,
        inputSnapshot: { taskId, stepId, verdict: payload.verdict, paramKeys: Object.keys(payload.paramValues) },
      };
  }
}
