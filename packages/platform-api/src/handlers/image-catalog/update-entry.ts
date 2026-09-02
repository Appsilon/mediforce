import { assertNamespaceAccess } from '../../auth';
import { NotFoundError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type {
  UpdateImageCatalogEntryInputApi,
  UpdateImageCatalogEntryOutput,
} from '../../contract/image-catalog';
import { actorFromCaller } from '../_helpers';
import { toEntryViews } from './_view';

export async function updateImageCatalogEntry(
  input: UpdateImageCatalogEntryInputApi,
  scope: CallerScope,
): Promise<UpdateImageCatalogEntryOutput> {
  assertNamespaceAccess(scope.caller, input.namespace);
  const { namespace, id, ...patch } = input;

  const existing = await scope.imageCatalog.getById(namespace, id);
  if (existing === null) {
    throw new NotFoundError(`Image catalog entry '${id}' not found`);
  }

  // `source` is not in the patch schema: it is the key the id derives from, so
  // an entry that changed it would be a different entry wearing an old id.
  const entry = await scope.imageCatalog.upsert(namespace, { ...existing, ...patch, id });

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'image_catalog_entry.updated',
    description: `Image catalog entry '${id}' updated in namespace '${namespace}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { namespace, id, patchKeys: Object.keys(patch) },
    outputSnapshot: { id: entry.id },
    basis: 'Image catalog entry updated via API',
    entityType: 'imageCatalogEntry',
    entityId: entry.id,
    namespace,
  });

  const [view] = await toEntryViews([entry], scope);
  return { entry: view };
}
