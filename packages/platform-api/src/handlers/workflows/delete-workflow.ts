import { OPEN_WORKFLOW_ACCESS } from '@mediforce/platform-core';
import type {
  DeleteWorkflowInput,
  DeleteWorkflowOutput,
} from '../../contract/workflows';
import type { CallerScope } from '../../repositories/index';
import { ConflictError } from '../../errors';
import { actorFromCaller } from '../_helpers';
import { assertCallerMayEditWorkflow } from './_access-gate';

/**
 * Soft-deletes a workflow definition and cascades the soft-delete to all
 * associated runs and human tasks. Audit attribution is sourced from the
 * caller via `actorFromCaller` (not hard-coded) so the audit trail reflects
 * who actually issued the deletion. Cascade covers the parent + all runs +
 * all human tasks, guarded by the `expectedRunCount` race check, plus the
 * triggers (ADR-0011) and workflow-scoped role grants (ADR-0019) that only
 * exist to serve this workflow.
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

  // ADR-0019 `edit`. Deletion is the most dangerous member of the verb and was
  // open to any member of the workspace until this landed. It runs *after* the
  // race guard, keeping the convention that an existence-shaped answer beats a
  // permission-shaped one: a non-member's read of the run count is 0, so they
  // still get the same 409 they got before this gate existed rather than a 403
  // that would tell them the workflow is there.
  await assertCallerMayEditWorkflow(scope, input.namespace, input.name);

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

  // ADR-0019: cascade — a role grant narrowed to this workflow has nothing
  // left to authorise, and no screen would ever show it again. Left in place
  // it silently reactivates the day someone registers the name afresh.
  // Workspace-wide grants (`workflowName: null`) are untouched.
  await scope.system.userDirectory?.clearRolesForWorkflow(input.namespace, input.name);

  // ADR-0019: the workflow's own access rows go the same way and for the same
  // reason — whoever registers this name next would otherwise inherit a `run`
  // and `edit` gate nobody configured for their workflow.
  await scope.workflowDefinitions.setAccess(input.namespace, input.name, OPEN_WORKFLOW_ACCESS);

  if (actualRunCount > 0) {
    const instanceIds = await scope.runs.getIdsByDefinitionName(input.namespace, input.name);
    await scope.runs.softDeleteByDefinitionName(input.namespace, input.name);
    await scope.tasks.softDeleteByInstanceIds(instanceIds);
  }

  return { success: true as const, deletedRuns: actualRunCount };
}
