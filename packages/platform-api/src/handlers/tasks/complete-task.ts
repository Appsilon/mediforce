import {
  InvalidTransitionError,
  CompleteHumanTaskValidationError,
  ParentInstanceNotFoundError,
} from '@mediforce/workflow-engine';
import type { CompleteTaskInput, CompleteTaskOutput } from '../../contract/tasks.js';
import type { CallerScope } from '../../repositories/index.js';
import {
  HandlerError,
  NotFoundError,
  PreconditionFailedError,
} from '../../errors.js';
import { loadOr404 } from '../_helpers.js';

/**
 * `POST /api/tasks/:taskId/complete`.
 *
 * Workspace gate via `scope.tasks.getById` (the wrapper layer returns null
 * for tasks outside the caller's namespaces); delegates state-machine work
 * to `engine.completeHumanTask`; emits two audit events
 * (`task.completed` + `process.resumed_after_task`) per ADR-0005 §7
 * handler-resident bridge; fires the auto-runner kick.
 *
 * Audit emission preserves the pre-migration shape exactly so existing
 * consumers (compliance trail, UI activity log) see no break.
 */
export async function completeTask(
  input: CompleteTaskInput,
  scope: CallerScope,
): Promise<CompleteTaskOutput> {
  const task = await loadOr404(
    scope.tasks.getById(input.taskId),
    'Task not found',
  );

  const isUser = scope.caller.kind === 'user';
  const actorId = isUser ? scope.caller.uid : task.assignedUserId ?? 'api-user';

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
  const payloadKind = input.payload.kind;
  const description =
    payloadKind === 'upload'
      ? `Task '${input.taskId}' resolved with ${input.payload.attachments.length} file(s) for step '${resolvedStepId}'`
      : payloadKind === 'assignment'
        ? `Task '${input.taskId}' resolved with ${input.payload.assignments.length} assignment(s) for step '${resolvedStepId}'`
        : payloadKind === 'rows'
          ? `Task '${input.taskId}' resolved with ${input.payload.rows.length} row(s) for step '${resolvedStepId}'`
          : payloadKind === 'params'
            ? `Task '${input.taskId}' resolved with param values for step '${resolvedStepId}'`
            : `Task '${input.taskId}' resolved with verdict '${input.payload.verdict}' for step '${resolvedStepId}'`;
  const inputSnapshot: Record<string, unknown> = {
    taskId: input.taskId,
    stepId: resolvedStepId,
    ...(payloadKind === 'upload'
      ? { fileCount: input.payload.attachments.length }
      : payloadKind === 'assignment'
        ? { assignmentCount: input.payload.assignments.length }
        : payloadKind === 'rows'
          ? { rowCount: input.payload.rows.length }
          : payloadKind === 'params'
            ? { paramKeys: Object.keys(input.payload.paramValues) }
            : { verdict: input.payload.verdict }),
  };

  await scope.system.audit.append({
    actorId,
    actorType: isUser ? 'user' : 'system',
    actorRole: 'operator',
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
    actorId,
    actorType: isUser ? 'user' : 'system',
    actorRole: 'operator',
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

  await scope.system.runKicker.kick(updatedTask.processInstanceId, {
    triggeredBy: actorId,
  });

  return { task: updatedTask, run: updatedInstance };
}
