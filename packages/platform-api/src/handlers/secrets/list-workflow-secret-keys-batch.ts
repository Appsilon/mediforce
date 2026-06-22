import type { CallerScope } from '../../repositories/index';
import type { ListWorkflowSecretKeysBatchInput, ListWorkflowSecretKeysBatchOutput } from '../../contract/secrets';

/**
 * Per-workflow key listing in a single round-trip. The wrapper soft-fails to
 * `[]` for non-members; each workflow entry surfaces independently — no
 * partial-error envelope (this is a pure read).
 */
export async function listWorkflowSecretKeysBatch(
  input: ListWorkflowSecretKeysBatchInput,
  scope: CallerScope,
): Promise<ListWorkflowSecretKeysBatchOutput> {
  const entries = await Promise.all(
    input.workflows.map(async (name) => {
      const keys = await scope.workflowSecrets.getSecretKeys(input.namespace, name);
      return [name, keys] as const;
    }),
  );
  return { keysByWorkflow: Object.fromEntries(entries) };
}
