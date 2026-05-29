import { assertCallerIsNamespaceAdmin } from '../../auth';
import type { CallerScope } from '../../repositories/index';
import type {
  DeleteToolCatalogEntryInput,
  DeleteToolCatalogEntryOutput,
} from '../../contract/tool-catalog';
import { actorFromCaller } from '../_helpers';

export async function deleteToolCatalogEntry(
  input: DeleteToolCatalogEntryInput,
  scope: CallerScope,
): Promise<DeleteToolCatalogEntryOutput> {
  assertCallerIsNamespaceAdmin(scope.caller, input.namespace);

  // Fetch-before-delete so the idempotent no-op case (id absent) doesn't
  // emit a misleading audit entry. The repo's `delete` returns void, hence
  // the separate read here. Matches the oauth-provider handler's audit-on-
  // actual-delete semantics.
  const existing = await scope.toolCatalog.getById(input.namespace, input.id);
  await scope.toolCatalog.delete(input.namespace, input.id);

  if (existing !== null) {
    const actor = actorFromCaller(scope);
    await scope.system.audit.append({
      ...actor,
      action: 'tool_catalog_entry.deleted',
      description: `Tool catalog entry '${input.id}' deleted from namespace '${input.namespace}'`,
      timestamp: new Date().toISOString(),
      inputSnapshot: { namespace: input.namespace, id: input.id },
      outputSnapshot: { id: input.id },
      basis: 'Tool catalog entry deleted via API',
      entityType: 'toolCatalogEntry',
      entityId: input.id,
      namespace: input.namespace,
    });
  }

  return { success: true };
}
