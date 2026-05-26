import type { CancelRunInput, CancelRunOutput } from '../../contract/processes.js';
import type { CallerScope } from '../../repositories/index.js';
import { PreconditionFailedError } from '../../errors.js';
import { loadOr404 } from '../_helpers.js';

const DEFAULT_REASON = 'Cancelled by user';

// Reuses scope.runs.update() rather than introducing a dedicated cancel
// method on the wrapper/repo (ADR-0005 §8 leaves that for a later pattern
// pass; PR1 set the precedent of keeping state-machine throws in the
// handler — see claim-task.ts).
//
// Audit action stays `instance.cancelled` to match workflow-engine's
// `instance.*` family (instance.created/started/paused/resumed/aborted/
// completed) and the legacy bulkCancelProcessRuns emit. A repo-wide
// `instance.*`/`process.*` → `run.*` rename ships as its own ADR pass.
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

  const isUser = scope.caller.kind === 'user';
  await scope.system.audit.append({
    actorId: isUser ? scope.caller.uid : 'api',
    actorType: isUser ? 'user' : 'system',
    actorRole: 'operator',
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
