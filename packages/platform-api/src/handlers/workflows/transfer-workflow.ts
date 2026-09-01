import type {
  TransferWorkflowInput,
  TransferWorkflowOutput,
} from '../../contract/workflows';
import type { CallerScope } from '../../repositories/index';
import { actorFromCaller } from '../_helpers';

/**
 * Move all versions of a workflow definition between workspaces. Transfer
 * requires caller membership on BOTH source and target namespaces, reads and
 * writes through the repository (not raw Firestore) so namespace scoping is
 * enforced, and emits a `workflow.transferred` audit event.
 *
 * The gate is membership-only on both namespaces; adding a role gate is a
 * separate decision.
 */
export async function transferWorkflowNamespace(
  input: TransferWorkflowInput,
  scope: CallerScope,
): Promise<TransferWorkflowOutput> {
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
