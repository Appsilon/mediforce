import type { RecordTaskViewedInput, RecordTaskViewedOutput } from '../../contract/tasks';
import type { CallerScope } from '../../repositories/index';
import { ForbiddenError } from '../../errors';
import { loadOr404 } from '../_helpers';

// No state change — this is pure instrumentation so Monitoring → Tasks has a
// real `task.viewed` signal. Anti-enum / not-found semantics come from
// `scope.tasks.getById` the same way `claimTask` gets them.
export async function recordTaskViewed(
  input: RecordTaskViewedInput,
  scope: CallerScope,
): Promise<RecordTaskViewedOutput> {
  if (scope.caller.kind !== 'user') {
    throw new ForbiddenError(
      'Cannot record a view as system actor — view requires an authenticated user',
    );
  }
  const uid = scope.caller.uid;

  const task = await loadOr404(scope.tasks.getById(input.taskId), 'Task not found');

  await scope.system.audit.append({
    actorId: uid,
    actorType: 'user',
    actorRole: 'operator',
    action: 'task.viewed',
    description: `User '${uid}' viewed task '${input.taskId}' for step '${task.stepId}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { taskId: input.taskId, userId: uid, stepId: task.stepId },
    outputSnapshot: {},
    basis: 'User viewed task via UI',
    entityType: 'humanTask',
    entityId: input.taskId,
    processInstanceId: task.processInstanceId,
  });

  return { recorded: true };
}
