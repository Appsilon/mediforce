import type {
  TransferWorkflowInput,
  TransferWorkflowOutput,
} from '../../contract/workflows.js';
import type { CallerScope } from '../../repositories/index.js';
import { actorFromCaller } from '../_helpers.js';

/**
 * Move all versions of a workflow definition between workspaces. Three
 * bug-fixes over the pre-Phase-2.5 Server Action:
 *   1. Reads through the repository instead of raw Firestore.
 *   2. Asserts caller membership on BOTH source AND target (was: target only;
 *      and even target was checked only at the routing layer, not enforced).
 *   3. Emits a `workflow.transferred` audit event (was: none).
 *
 * Gate stays member-only on both — this is parity-with-tightening, not a
 * role-gate uplift (role enforcement is Phase 2.6 territory).
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
  });

  return {
    success: true as const,
    name: input.name,
    sourceNamespace: input.sourceNamespace,
    targetNamespace: input.targetNamespace,
  };
}
