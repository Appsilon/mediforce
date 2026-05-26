import type { CancelRunInput, CancelRunOutput } from '../../contract/processes.js';
import type { CallerScope } from '../../repositories/index.js';
import { PreconditionFailedError } from '../../errors.js';
import { emitAudit, loadOr404 } from '../_helpers.js';

// `actorId` for system callers is `'api-user'` (the canonical default from
// `actorFromCaller`); the prior `'api'` was an inconsistency vs every other
// handler. UI-vs-CLI-vs-API cancellation channel is captured by #509 via a
// separate field, not by actorId.

const DEFAULT_REASON = 'Cancelled by user';

// Reuses scope.runs.update() rather than a dedicated wrapper cancel method
// (state-machine throw stays in the handler, mirroring claim-task.ts).
//
// Audit action `instance.cancelled` aligns with workflow-engine's
// `instance.*` family (instance.created/started/paused/resumed/aborted/
// completed). A repo-wide `instance.*` → `run.*` rename is its own pass.
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

  await emitAudit(scope, {
    action: 'instance.cancelled',
    description: `Run cancelled by operator (was ${run.status}${run.currentStepId ? ` at step '${run.currentStepId}'` : ''})`,
    timestamp: now,
    inputSnapshot: { previousStatus: run.status, currentStepId: run.currentStepId },
    outputSnapshot: { status: 'failed', error: reason },
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
