import type { ResumeRunInput, ResumeRunOutput } from '../../contract/processes.js';
import type { CallerScope } from '../../repositories/index.js';
import { PreconditionFailedError } from '../../errors.js';
import { actorFromCaller, loadOr404 } from '../_helpers.js';

// `failed` source state covers agent-escalated / agent-paused recovery.
export async function resumeRun(
  input: ResumeRunInput,
  scope: CallerScope,
): Promise<ResumeRunOutput> {
  const run = await loadOr404(scope.runs.getById(input.runId), 'Run not found');

  if (run.status !== 'paused' && run.status !== 'failed') {
    throw new PreconditionFailedError(
      `Cannot resume a ${run.status} run; current status: ${run.status}`,
      { runId: input.runId, currentStatus: run.status },
    );
  }

  const now = new Date().toISOString();
  await scope.runs.update(input.runId, {
    status: 'running',
    pauseReason: null,
    error: null,
    updatedAt: now,
  });

  const actor = actorFromCaller(scope);

  await scope.system.audit.append({
    ...actor,
    action: 'instance.resumed',
    description: `Process '${input.runId}' manually resumed via API`,
    timestamp: now,
    inputSnapshot: {
      previousStatus: run.status,
      previousPauseReason: run.pauseReason,
    },
    outputSnapshot: { status: 'running' },
    basis: 'Manual resume via API',
    entityType: 'processInstance',
    entityId: input.runId,
    processInstanceId: input.runId,
    processDefinitionVersion: run.definitionVersion,
  });

  await scope.system.runKicker.kick(input.runId, { triggeredBy: actor.actorId });

  const updated = await loadOr404(scope.runs.getById(input.runId), 'Run not found');
  return { run: updated };
}
