import type { CallerScope } from '../../repositories/index.js';
import type {
  SaveWorkflowSecretsInput,
  SaveWorkflowSecretsOutput,
} from '../../contract/secrets.js';

/**
 * Atomic bulk replace of workflow-scoped secrets. Used by the secrets-management
 * UI's "Save" action — the editor sends the whole set, the store overwrites
 * (any keys the editor dropped get removed). The wrapper's `setSecrets` calls
 * `assertNamespaceWrite`, which throws `ForbiddenError` for non-members — the
 * adapter maps that to 403, so this handler doesn't pre-check.
 *
 * Audit records the saved key set (not values) so an admin can later trace
 * "which keys lived on this workflow at time T" without ever leaking plaintext.
 */
export async function saveWorkflowSecrets(
  input: SaveWorkflowSecretsInput,
  scope: CallerScope,
): Promise<SaveWorkflowSecretsOutput> {
  await scope.workflowSecrets.setSecrets(input.namespace, input.workflow, input.secrets);

  const savedKeys = Object.keys(input.secrets);
  const isUser = scope.caller.kind === 'user';
  await scope.system.audit.append({
    actorId: isUser ? scope.caller.uid : 'api',
    actorType: isUser ? 'user' : 'system',
    actorRole: 'operator',
    action: 'workflow_secret.bulk_saved',
    description: `Workflow secrets atomically replaced for workflow '${input.workflow}' in namespace '${input.namespace}' (${savedKeys.length} key(s))`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { namespace: input.namespace, workflow: input.workflow, savedKeys },
    outputSnapshot: { savedKeyCount: savedKeys.length },
    basis: 'Operator saved workflow secrets editor (atomic bulk replace)',
    entityType: 'workflowSecret',
    entityId: `${input.namespace}/${input.workflow}`,
    namespace: input.namespace,
  });

  return { ok: true, savedKeyCount: savedKeys.length };
}
