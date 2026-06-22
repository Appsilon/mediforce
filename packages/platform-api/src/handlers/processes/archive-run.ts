import type { ArchiveRunInput, ArchiveRunOutput } from '../../contract/processes';
import type { CallerScope } from '../../repositories/index';
import { PreconditionFailedError } from '../../errors';
import { actorFromCaller, loadOr404 } from '../_helpers';
import { isRunActiveForArchive } from './_run-active';

// Audit action `instance.archived` / `instance.unarchived` aligns with the
// existing `instance.*` family. Active runs are blocked to mirror the legacy
// Server Action's `displayStatus === 'in_progress' | 'waiting_for_human'` gate.
export async function archiveRun(input: ArchiveRunInput, scope: CallerScope): Promise<ArchiveRunOutput> {
  const run = await loadOr404(scope.runs.getById(input.runId), 'Run not found');

  if (isRunActiveForArchive(run)) {
    throw new PreconditionFailedError('Cannot archive an active run', {
      runId: input.runId,
      currentStatus: run.status,
      pauseReason: run.pauseReason ?? null,
    });
  }

  const now = new Date().toISOString();
  const previousArchived = run.archived ?? false;

  await scope.runs.update(input.runId, { archived: input.archived, updatedAt: now });

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: input.archived ? 'instance.archived' : 'instance.unarchived',
    description: `Run ${input.archived ? 'archived' : 'unarchived'} by operator`,
    timestamp: now,
    inputSnapshot: { previousArchived },
    outputSnapshot: { archived: input.archived },
    basis: 'User-initiated archive via UI',
    entityType: 'processInstance',
    entityId: input.runId,
    processInstanceId: input.runId,
    processDefinitionVersion: run.definitionVersion,
  });

  const updated = await loadOr404(scope.runs.getById(input.runId), 'Run not found');
  return { run: updated };
}
