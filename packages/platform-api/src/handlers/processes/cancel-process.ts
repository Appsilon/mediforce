import type { CancelProcessInput, CancelProcessOutput } from '../../contract/processes.js';
import type { CallerScope } from '../../repositories/index.js';
import { PreconditionFailedError } from '../../errors.js';
import { loadOr404 } from '../_helpers.js';

const DEFAULT_REASON = 'Cancelled by user';

// Reuses scope.runs.update() rather than introducing a dedicated cancel
// method on the wrapper/repo (ADR-0005 §8 leaves that for a later pattern
// pass; PR1 set the precedent of keeping state-machine throws in the
// handler — see claim-task.ts).
export async function cancelProcess(
  input: CancelProcessInput,
  scope: CallerScope,
): Promise<CancelProcessOutput> {
  const run = await loadOr404(
    scope.runs.getById(input.instanceId),
    'Instance not found',
  );

  if (run.status !== 'running' && run.status !== 'paused') {
    throw new PreconditionFailedError(
      `Cannot cancel a ${run.status} run; current status: ${run.status}`,
      { instanceId: input.instanceId, currentStatus: run.status },
    );
  }

  const reason = input.reason ?? DEFAULT_REASON;
  const now = new Date().toISOString();

  await scope.runs.update(input.instanceId, {
    status: 'failed',
    error: reason,
    updatedAt: now,
  });

  const isUser = scope.caller.kind === 'user';
  await scope.system.audit.append({
    actorId: isUser ? scope.caller.uid : 'api',
    actorType: isUser ? 'user' : 'system',
    actorRole: 'operator',
    action: 'process.cancelled',
    description: `Run cancelled by operator (was ${run.status}${run.currentStepId ? ` at step '${run.currentStepId}'` : ''})`,
    timestamp: now,
    inputSnapshot: { previousStatus: run.status, currentStepId: run.currentStepId },
    outputSnapshot: { status: 'failed', error: reason },
    basis: 'User-initiated cancel via UI — double-confirm pattern',
    entityType: 'processInstance',
    entityId: input.instanceId,
    processInstanceId: input.instanceId,
    processDefinitionVersion: run.definitionVersion,
  });

  const updated = await loadOr404(
    scope.runs.getById(input.instanceId),
    'Instance not found',
  );
  return { run: updated };
}
