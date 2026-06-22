import type { ClaimTaskInput, ClaimTaskOutput } from '../../contract/tasks';
import type { CallerScope } from '../../repositories/index';
import { ForbiddenError, PreconditionFailedError } from '../../errors';
import { loadOr404 } from '../_helpers';

// PR1 deviation from ADR-0005 §2a: state-machine precondition stays in the
// handler. Wrapper migration deferred until claim/complete/resolve/cancel
// move together.
export async function claimTask(input: ClaimTaskInput, scope: CallerScope): Promise<ClaimTaskOutput> {
  if (scope.caller.kind !== 'user') {
    throw new ForbiddenError('Cannot claim as system actor — claim requires an authenticated user');
  }
  const uid = scope.caller.uid;

  const task = await loadOr404(scope.tasks.getById(input.taskId), 'Task not found');

  if (task.status !== 'pending') {
    throw new PreconditionFailedError(`Cannot claim a ${task.status} task; current status: ${task.status}`, {
      taskId: input.taskId,
      currentStatus: task.status,
    });
  }

  const claimed = await scope.tasks.claim(input.taskId, uid);

  await scope.system.audit.append({
    actorId: uid,
    actorType: 'user',
    actorRole: 'operator',
    action: 'task.claimed',
    description: `User '${uid}' claimed task '${input.taskId}' for step '${task.stepId}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { taskId: input.taskId, userId: uid, stepId: task.stepId },
    outputSnapshot: { status: 'claimed', assignedUserId: uid },
    basis: 'User claimed task via UI',
    entityType: 'humanTask',
    entityId: input.taskId,
    processInstanceId: task.processInstanceId,
  });

  return { task: claimed };
}
