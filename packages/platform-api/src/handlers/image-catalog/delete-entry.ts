import { assertNamespaceAccess } from '../../auth';
import type { CallerScope } from '../../repositories/index';
import type {
  DeleteImageCatalogEntryInput,
  DeleteImageCatalogEntryOutput,
} from '../../contract/image-catalog';
import { actorFromCaller } from '../_helpers';

export async function deleteImageCatalogEntry(
  input: DeleteImageCatalogEntryInput,
  scope: CallerScope,
): Promise<DeleteImageCatalogEntryOutput> {
  assertNamespaceAccess(scope.caller, input.namespace);

  // Deleting an entry removes an offer, never a capability: no Workflow
  // Definition points at one, so no run changes behaviour (ADR-0021
  // decision 3). Fetch-before-delete only so an idempotent no-op does not
  // emit a misleading audit entry.
  const existing = await scope.imageCatalog.getById(input.namespace, input.id);
  await scope.imageCatalog.delete(input.namespace, input.id);

  if (existing !== null) {
    const actor = actorFromCaller(scope);
    await scope.system.audit.append({
      ...actor,
      action: 'image_catalog_entry.deleted',
      description: `Image catalog entry '${input.id}' deleted from namespace '${input.namespace}'`,
      timestamp: new Date().toISOString(),
      inputSnapshot: { namespace: input.namespace, id: input.id },
      outputSnapshot: { id: input.id },
      basis: 'Image catalog entry deleted via API',
      entityType: 'imageCatalogEntry',
      entityId: input.id,
      namespace: input.namespace,
    });
  }

  return { success: true };
}
