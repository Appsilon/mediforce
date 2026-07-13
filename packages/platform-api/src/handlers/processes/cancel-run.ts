import type { HumanTaskStatus } from '@mediforce/platform-core';
import type { CancelRunInput, CancelRunOutput } from '../../contract/processes';
import { ACTIONABLE_STATUSES } from '../../contract/tasks';
import type { CallerScope } from '../../repositories/index';
import { PreconditionFailedError } from '../../errors';
import { loadOr404 } from '../_helpers';

const DEFAULT_REASON = 'Cancelled by user';
const ACTIONABLE_TASK_STATUSES = new Set<HumanTaskStatus>(ACTIONABLE_STATUSES);

export async function cancelRun(
  input: CancelRunInput,
  scope: CallerScope,
): Promise<CancelRunOutput> {
  const run = await loadOr404(
    scope.runs.getById(input.runId),
    'Run not found',
  );

  if (run.status !== 'running' && run.status !== 'paused') {
    throw new PreconditionFailedError(
      `Cannot cancel a ${run.status} run; current status: ${run.status}`,
      { runId: input.runId, currentStatus: run.status },
    );
  }

  const reason = input.reason ?? DEFAULT_REASON;
  const now = new Date().toISOString();

  await scope.runs.update(input.runId, {
    status: 'failed',
    error: reason,
    updatedAt: now,
  });

  const tasks = await scope.tasks.getByInstanceId(input.runId);
  const actionableTasks = tasks.filter((task) =>
    ACTIONABLE_TASK_STATUSES.has(task.status),
  );
  await Promise.all(actionableTasks.map((task) => scope.tasks.cancel(task.id)));

  const isUser = scope.caller.kind === 'user';
  await scope.system.audit.append({
    actorId: isUser ? scope.caller.uid : 'api',
    actorType: isUser ? 'user' : 'system',
    actorRole: 'operator',
    action: 'instance.cancelled',
    description: `Run cancelled by operator (was ${run.status}${run.currentStepId ? ` at step '${run.currentStepId}'` : ''})`,
    timestamp: now,
    inputSnapshot: { previousStatus: run.status, currentStepId: run.currentStepId },
    outputSnapshot: { status: 'failed', error: reason, cancelledTasks: actionableTasks.length },
    basis: 'User-initiated cancel via UI — double-confirm pattern',
    entityType: 'processInstance',
    entityId: input.runId,
    processInstanceId: input.runId,
    processDefinitionVersion: run.definitionVersion,
  });

  const updated = await loadOr404(
    scope.runs.getById(input.runId),
    'Run not found',
  );
  return { run: updated };
}
