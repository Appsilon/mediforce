import type { CallerScope } from '../../repositories/index';
import type {
  GetWorkspaceSecretPreviewsInput,
  GetWorkspaceSecretPreviewsOutput,
  SecretPreview,
} from '../../contract/secrets';

// Mask format matches the legacy `getNamespaceSecretPreviews` action: first 4
// + last 4 chars for values long enough to anchor visually, eight bullets
// otherwise. Kept identical so the editor's "did the new value land" feedback
// loop doesn't shift after migration.
function maskValue(value: string): string {
  if (value.length > 12) return `${value.slice(0, 4)}...${value.slice(-4)}`;
  return '•'.repeat(8);
}

/**
 * Workspace-scope only: return masked previews for the secrets editor. Non-
 * members soft-fail to `{ previews: [] }` via the wrapper's `canSeeNamespace`
 * gate (no enumeration leak).
 */
export async function getWorkspaceSecretPreviews(
  input: GetWorkspaceSecretPreviewsInput,
  scope: CallerScope,
): Promise<GetWorkspaceSecretPreviewsOutput> {
  const secrets = await scope.workspaceSecrets.getSecrets(input.namespace);
  const previews: SecretPreview[] = Object.entries(secrets).map(([key, value]) => ({
    key,
    preview: maskValue(value),
  }));
  return { previews };
}
