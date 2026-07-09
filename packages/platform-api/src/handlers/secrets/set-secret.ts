import type { CallerScope } from '../../repositories/index';
import type { SetSecretInput, SetSecretOutput } from '../../contract/secrets';

/**
 * Upsert a secret value. When `workflow` is set, writes to the workflow-
 * scoped store; otherwise writes to the workspace-scoped store. The wrapper
 * (`assertNamespaceWrite`) throws `ForbiddenError` for non-members — the
 * adapter maps that to 403, so this handler never pre-checks.
 */
export async function setSecret(
  input: SetSecretInput,
  scope: CallerScope,
): Promise<SetSecretOutput> {
  if (input.workflow !== undefined) {
    await scope.workflowSecrets.upsertSecret(
      input.namespace,
      input.workflow,
      input.key,
      input.value,
    );
  } else {
    await scope.workspaceSecrets.upsertSecret(input.namespace, input.key, input.value);
  }
  return { ok: true };
}
