import type {
  DeleteWorkflowInput,
  DeleteWorkflowOutput,
} from '../../contract/workflows';
import type { CallerScope } from '../../repositories/index';
import { ConflictError } from '../../errors';
import { actorFromCaller } from '../_helpers';

/**
 * Soft-deletes a workflow definition and cascades the soft-delete to all
 * associated runs and human tasks. Audit attribution is sourced from the
 * caller via `actorFromCaller` (not hard-coded) so the audit trail reflects
 * who actually issued the deletion. Cascade covers the parent + all runs +
 * all human tasks, guarded by the `expectedRunCount` race check.
 */
export async function deleteWorkflow(
  input: DeleteWorkflowInput,
  scope: CallerScope,
): Promise<DeleteWorkflowOutput> {
  const actualRunCount = await scope.workflowDefinitions.countInstancesByName(
    input.namespace,
    input.name,
  );
  if (actualRunCount !== input.expectedRunCount) {
    throw new ConflictError(
      `Run count changed (expected ${input.expectedRunCount}, found ${actualRunCount}). Please try again.`,
    );
  }

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'workflow.delete',
    description: `Workflow "${input.name}" soft-deleted with ${actualRunCount} associated runs`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { workflowName: input.name, namespace: input.namespace, runCount: actualRunCount },
    outputSnapshot: {},
    basis: 'User-initiated workflow deletion',
    entityType: 'workflow_definition',
    entityId: input.name,
    namespace: input.namespace,
  });

  await scope.workflowDefinitions.setDeleted(input.namespace, input.name, true);

  // ADR-0011: cascade — Triggers are meaningless without their workflow.
  await scope.triggers.deleteByWorkflow(input.namespace, input.name);

  if (actualRunCount > 0) {
    const instanceIds = await scope.runs.getIdsByDefinitionName(input.name);
    await scope.runs.softDeleteByDefinitionName(input.name);
    await scope.tasks.softDeleteByInstanceIds(instanceIds);
  }

  return { success: true as const, deletedRuns: actualRunCount };
}
