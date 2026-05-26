import type { ResumeRunInput, ResumeRunOutput } from '../../contract/processes.js';
import type { CallerScope } from '../../repositories/index.js';
import { PreconditionFailedError } from '../../errors.js';
import { loadOr404 } from '../_helpers.js';

/**
 * `POST /api/processes/:instanceId/resume`.
 *
 * State transition `paused | failed → running`. Allowing `failed` here
 * covers the agent-escalated / agent-paused recovery flow surfaced by the
 * UI banner — same source-state set as the pre-migration inline route.
 * Audit emission via handler-resident bridge per ADR-0005 §7. The auto-
 * runner kick fires after the state flip so the run picks up where it
 * paused.
 */
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

  const isUser = scope.caller.kind === 'user';
  const actorId = isUser ? scope.caller.uid : 'api-user';

  await scope.system.audit.append({
    actorId,
    actorType: isUser ? 'user' : 'system',
    actorRole: 'operator',
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

  await scope.system.runKicker.kick(input.runId, { triggeredBy: actorId });

  const updated = await loadOr404(scope.runs.getById(input.runId), 'Run not found');
  return { run: updated };
}
