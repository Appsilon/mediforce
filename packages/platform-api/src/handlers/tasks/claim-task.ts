import type { AuditRepository, HumanTaskRepository } from '@mediforce/platform-core';
import type { ClaimTaskInput, ClaimTaskOutput } from '../../contract/tasks.js';
import { ConflictError, NotFoundError } from '../../errors.js';

export interface ClaimTaskDeps {
  humanTaskRepo: HumanTaskRepository;
  auditRepo: AuditRepository;
}

/**
 * Pure handler: claim a pending task for the caller.
 *
 * State-machine precondition: task must be `pending`. Any other status throws
 * `ConflictError` (maps to 409). Writes a `task.claimed` audit event. The
 * `userId` input defaults to `'api-user'` when omitted — preserves the
 * pre-migration behaviour where the inline route accepted an empty body.
 */
export async function claimTask(
  input: ClaimTaskInput,
  deps: ClaimTaskDeps,
): Promise<ClaimTaskOutput> {
  const userId = input.userId ?? 'api-user';

  const task = await deps.humanTaskRepo.getById(input.taskId);
  if (task === null) {
    throw new NotFoundError(`Task ${input.taskId} not found`);
  }
  if (task.status !== 'pending') {
    throw new ConflictError(`Cannot claim a ${task.status} task`);
  }

  const claimed = await deps.humanTaskRepo.claim(input.taskId, userId);

  const now = new Date().toISOString();
  await deps.auditRepo.append({
    actorId: userId,
    actorType: 'user',
    actorRole: 'operator',
    action: 'task.claimed',
    description: `User '${userId}' claimed task '${input.taskId}' for step '${task.stepId}'`,
    timestamp: now,
    inputSnapshot: { taskId: input.taskId, userId, stepId: task.stepId },
    outputSnapshot: { status: 'claimed', assignedUserId: userId },
    basis: 'User claimed task via API',
    entityType: 'humanTask',
    entityId: input.taskId,
    processInstanceId: task.processInstanceId,
  });

  return claimed;
}
