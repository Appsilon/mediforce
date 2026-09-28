import { assertNamespaceAccess } from '../../auth';
import { ConflictError, NotFoundError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type {
  UpdateImageCatalogEntryInputApi,
  UpdateImageCatalogEntryOutput,
} from '../../contract/image-catalog';
import { actorFromCaller } from '../_helpers';
import { fetchDaemonImages } from '../system/_docker';
import { toEntryView } from './_view';
import { canonicalizeSource, deriveImageCatalogEntryId } from './_source';
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

  // The source is the key the id derives from, so a corrected repo or
  // Dockerfile cannot be a column write: the entry moves to the id its new
  // source derives (ADR-0022 decision 1). Canonicalise first — a source that
  // only spells the same key differently derives the same id and stays put,
  // which is why this compares ids rather than sources.
  const source =
    patch.source === undefined ? existing.source : canonicalizeSource(patch.source);
  const nextId = deriveImageCatalogEntryId(source);
  const rekeyed = nextId !== id;

  if (rekeyed) {
    // Upserting blind would overwrite the occupant's own sentence and then
    // delete the row the caller was editing — two entries lost to one edit.
    const occupant = await scope.imageCatalog.getById(namespace, nextId);
    if (occupant !== null) {
      throw new ConflictError(
        `Image catalog entry '${occupant.id}' ("${occupant.name}") already describes that source in namespace '${namespace}'. Edit or delete that entry instead.`,
      );
    }
  }

  // One daemon read for the whole write: the probe and the response view ask
  // the same questions of it.
  const daemon = await fetchDaemonImages();
  // Write the new key before removing the old one. The reverse order loses the
  // entry outright if the write fails; this order's worst case is the corrected
  // row sitting beside the one it replaces, which a reader can see and fix.
  const entry = await scope.imageCatalog.upsert(namespace, {
    ...existing,
    ...patch,
    source,
    id: nextId,
  });
  if (rekeyed) {
    await scope.imageCatalog.delete(namespace, id);
  }
  const refreshedEntry = await refreshEntryCapabilities(namespace, entry, scope, daemon);

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'image_catalog_entry.updated',
    description: `Image catalog entry '${refreshedEntry.id}' updated in namespace '${namespace}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { namespace, id, patchKeys: Object.keys(patch) },
    outputSnapshot: { id: refreshedEntry.id },
    basis: 'Image catalog entry updated via API',
    entityType: 'imageCatalogEntry',
    entityId: refreshedEntry.id,
    namespace,
  });
  if (rekeyed) {
    // A second event against the *old* id. A re-key is the one update that
    // leaves an id with no row, so without this the history of the id a reader
    // remembers stops dead at the edit that moved it.
    await scope.system.audit.append({
      ...actor,
      action: 'image_catalog_entry.rekeyed',
      description: `Image catalog entry '${id}' re-keyed to '${refreshedEntry.id}' in namespace '${namespace}': its source changed`,
      timestamp: new Date().toISOString(),
      inputSnapshot: { namespace, id, source: existing.source },
      outputSnapshot: { id: refreshedEntry.id, source: refreshedEntry.source },
      basis: 'Image catalog entry source changed via API',
      entityType: 'imageCatalogEntry',
      entityId: id,
      namespace,
    });
  }

  return { entry: await toEntryView(namespace, refreshedEntry, scope, daemon) };
}
