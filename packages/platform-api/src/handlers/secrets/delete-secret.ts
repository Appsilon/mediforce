import type { CallerScope } from '../../repositories/index.js';
import type {
  DeleteSecretInput,
  DeleteSecretOutput,
} from '../../contract/secrets.js';

/**
 * Delete a secret. Workflow-scoped when `workflow` is set, workspace-scoped
 * otherwise. The wrapper throws `ApiError('forbidden', …)` for non-members; this
 * handler delegates and trusts the adapter to translate the throw.
 */
export async function deleteSecret(
  input: DeleteSecretInput,
  scope: CallerScope,
): Promise<DeleteSecretOutput> {
  if (input.workflow !== undefined) {
    await scope.workflowSecrets.deleteSecret(input.namespace, input.workflow, input.key);
  } else {
    await scope.workspaceSecrets.deleteSecret(input.namespace, input.key);
  }
  return { ok: true };
}
