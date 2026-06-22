import type { CallerScope } from '../../repositories/index';
import type { ListSecretKeysInput, ListSecretKeysOutput } from '../../contract/secrets';

/**
 * List secret keys (not values) for a workspace, or for a specific workflow
 * inside a workspace when `workflow` is set. The `scope.workspaceSecrets` /
 * `scope.workflowSecrets` wrappers soft-fail to `[]` for non-members — the
 * handler simply wraps the result.
 */
export async function listSecretKeys(input: ListSecretKeysInput, scope: CallerScope): Promise<ListSecretKeysOutput> {
  const keys =
    input.workflow !== undefined
      ? await scope.workflowSecrets.getSecretKeys(input.namespace, input.workflow)
      : await scope.workspaceSecrets.getSecretKeys(input.namespace);
  return { keys };
}
