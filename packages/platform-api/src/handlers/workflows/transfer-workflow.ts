import { OPEN_WORKFLOW_ACCESS } from '@mediforce/platform-core';
import type {
  TransferWorkflowInput,
  TransferWorkflowOutput,
} from '../../contract/workflows';
import type { CallerScope } from '../../repositories/index';
import { actorFromCaller } from '../_helpers';
import { assertCallerMayEditWorkflow } from './_access-gate';

/**
 * Move all versions of a workflow definition between workspaces. Transfer
 * requires caller membership on BOTH source and target namespaces, reads and
 * writes through the repository (not raw Firestore) so namespace scoping is
 * enforced, and emits a `workflow.transferred` audit event.
 *
 * Membership on both namespaces is necessary but no longer sufficient: moving
 * a workflow out of a workspace is an `edit` (ADR-0019), gated on the source's
 * role list. The destination has none for a name it has never seen.
 */
export async function transferWorkflowNamespace(
  input: TransferWorkflowInput,
  scope: CallerScope,
): Promise<TransferWorkflowOutput> {
  await assertCallerMayEditWorkflow(scope, input.sourceNamespace, input.name);

  await scope.workflowDefinitions.transferNamespace(
    input.name,
    input.sourceNamespace,
    input.targetNamespace,
  );

  // ADR-0011: trigger rows are independently namespaced, so move them with the
  // definition. Left behind, the source heartbeat can no longer resolve the
  // moved workflow and the destination has no schedule — scheduled automation
  // would silently stop.
  await scope.triggers.transferWorkflowNamespace(
    input.sourceNamespace,
    input.name,
    input.targetNamespace,
  );

  // ADR-0019: grants narrowed to `(sourceNamespace, name)` do not follow the
  // workflow. Copying them would hand a role to people who are not members of
  // the target workspace — the leak the ADR rejects — and leaving them puts
  // the source name back in circulation with live permissions attached to it:
  // whoever registers that name next silently inherits reviewers nobody
  // granted. Same reasoning as `deleteWorkflow`, same call. Workspace-wide
  // grants in the source (`workflowName: null`) are untouched — they were
  // never about this workflow.
  await scope.system.userDirectory?.clearRolesForWorkflow(input.sourceNamespace, input.name);

  // The `run` / `edit` lists stay behind too. They name roles, and a role name
  // means different people in the destination workspace — carrying `edit:
  // ['reviewer']` across would hand the workflow to whoever happens to hold
  // that name there. The destination's owner/admin configures it afresh, and
  // until they do the workflow is open to their members, as a newly
  // registered one would be.
  await scope.workflowDefinitions.setAccess(
    input.sourceNamespace,
    input.name,
    OPEN_WORKFLOW_ACCESS,
  );

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'workflow.transferred',
    description: `Workflow '${input.name}' transferred from '${input.sourceNamespace}' to '${input.targetNamespace}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: {
      name: input.name,
      sourceNamespace: input.sourceNamespace,
      targetNamespace: input.targetNamespace,
    },
    outputSnapshot: { namespace: input.targetNamespace },
    basis: 'Workflow namespace transferred via API',
    entityType: 'workflow_definition',
    entityId: input.name,
    namespace: input.targetNamespace,
  });

  return {
    success: true as const,
    name: input.name,
    sourceNamespace: input.sourceNamespace,
    targetNamespace: input.targetNamespace,
  };
}
