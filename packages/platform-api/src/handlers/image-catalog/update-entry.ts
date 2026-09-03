import { assertNamespaceAccess } from '../../auth';
import { NotFoundError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type {
  UpdateImageCatalogEntryInputApi,
  UpdateImageCatalogEntryOutput,
} from '../../contract/image-catalog';
import { actorFromCaller } from '../_helpers';
import { fetchDaemonImages } from '../system/_docker';
import { toEntryView } from './_view';
import { refreshEntryCapabilities } from './_capabilities';

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

  // One daemon read for the whole write: the probe and the response view ask
  // the same questions of it.
  const daemon = await fetchDaemonImages();
  // `source` is not in the patch schema: it is the key the id derives from, so
  // an entry that changed it would be a different entry wearing an old id.
  const entry = await scope.imageCatalog.upsert(namespace, { ...existing, ...patch, id });
  const refreshedEntry = await refreshEntryCapabilities(namespace, entry, scope, daemon);

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'image_catalog_entry.updated',
    description: `Image catalog entry '${id}' updated in namespace '${namespace}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { namespace, id, patchKeys: Object.keys(patch) },
    outputSnapshot: { id: refreshedEntry.id },
    basis: 'Image catalog entry updated via API',
    entityType: 'imageCatalogEntry',
    entityId: refreshedEntry.id,
    namespace,
  });

  return { entry: await toEntryView(namespace, refreshedEntry, scope, daemon) };
}
