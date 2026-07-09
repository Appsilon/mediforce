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
