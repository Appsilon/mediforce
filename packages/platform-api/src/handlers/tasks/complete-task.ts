import {
  InvalidTransitionError,
  CompleteHumanTaskValidationError,
  ParentInstanceNotFoundError,
} from '@mediforce/workflow-engine';
import type { CompleteHumanTaskPayload } from '@mediforce/platform-core';
import type { CompleteTaskInput, CompleteTaskOutput } from '../../contract/tasks.js';
import type { CallerScope } from '../../repositories/index.js';
import {
  HandlerError,
  NotFoundError,
  PreconditionFailedError,
} from '../../errors.js';
import { actorFromCaller, emitAudit, loadOr404 } from '../_helpers.js';

interface AuditFields {
  description: string;
  inputSnapshot: Record<string, unknown>;
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
  }
}

export async function completeTask(
  input: CompleteTaskInput,
  scope: CallerScope,
): Promise<CompleteTaskOutput> {
  const task = await loadOr404(
    scope.tasks.getById(input.taskId),
    'Task not found',
  );

  const actor = actorFromCaller(scope);
  // Fall back to the task's prior assignee for apiKey callers so the audit
  // trail reflects the human who claimed the task, not 'api-user'.
  const actorId = scope.caller.kind === 'user'
    ? actor.actorId
    : task.assignedUserId ?? actor.actorId;

  let result;
  try {
    result = await scope.system.engine.completeHumanTask(
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

  const { task: updatedTask, instance: updatedInstance, resolvedStepId } = result;
  const now = new Date().toISOString();
  const completionData =
    (updatedTask.completionData as Record<string, unknown> | null) ?? {};
  const { description, inputSnapshot } = auditFieldsFor(
    input.payload,
    input.taskId,
    resolvedStepId,
  );
  const auditActor = { ...actor, actorId };

  await emitAudit(scope, {
    actor: auditActor,
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

  await emitAudit(scope, {
    actor: auditActor,
    action: 'process.resumed_after_task',
    description: `Process '${updatedTask.processInstanceId}' resumed after resolving step '${resolvedStepId}'`,
    inputSnapshot: {
      taskId: input.taskId,
      processInstanceId: updatedTask.processInstanceId,
      stepId: resolvedStepId,
    },
    basis: 'Task resolution triggered process advancement',
    entityType: 'processInstance',
    entityId: updatedTask.processInstanceId,
    processInstanceId: updatedTask.processInstanceId,
  });

  await scope.system.runKicker.kick(updatedTask.processInstanceId, {
    triggeredBy: actorId,
  });

  return { task: updatedTask, run: updatedInstance };
}
