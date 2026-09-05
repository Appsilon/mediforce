import { ImageCatalogEntrySchema } from '@mediforce/platform-core';
import { assertNamespaceAccess } from '../../auth';
import { HandlerError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type {
  CreateImageCatalogEntryInputApi,
  CreateImageCatalogEntryOutput,
} from '../../contract/image-catalog';
import { actorFromCaller } from '../_helpers';
import { fetchDaemonImages } from '../system/_docker';
import { canonicalizeSource, deriveImageCatalogEntryId } from './_source';
import { refreshEntryCapabilities } from './_capabilities';
import { toEntryView } from './_view';

export async function createImageCatalogEntry(
  input: CreateImageCatalogEntryInputApi,
  scope: CallerScope,
): Promise<CreateImageCatalogEntryOutput> {
  // Any workspace member, not an admin: an entry executes nothing and names an
  // image string an author can already type into the step editor (ADR-0021
  // decision 3).
  assertNamespaceAccess(scope.caller, input.namespace);
  const { namespace, source, ...rest } = input;

  const canonical = canonicalizeSource(source);
  const id = deriveImageCatalogEntryId(canonical);

  const parsed = ImageCatalogEntrySchema.safeParse({ ...rest, source: canonical, id });
  if (!parsed.success) {
    throw new HandlerError(
      'validation',
      parsed.error.issues[0]?.message ?? 'Invalid input',
      parsed.error.issues,
    );
  }

  const existing = await scope.imageCatalog.getById(namespace, id);
  if (existing !== null) {
    throw new HandlerError(
      'conflict',
      `Image catalog entry "${id}" already describes this source in namespace "${namespace}".`,
    );
  }

  // One daemon read for the whole write: the probe and the response view
  // ask the same questions of it.
  const daemon = await fetchDaemonImages();
  const entry = await scope.imageCatalog.upsert(namespace, parsed.data);
  const refreshedEntry = await refreshEntryCapabilities(namespace, entry, scope, daemon);

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'image_catalog_entry.created',
    description: `Image catalog entry '${refreshedEntry.id}' created in namespace '${namespace}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { namespace, id: refreshedEntry.id, name: refreshedEntry.name, source: refreshedEntry.source },
    outputSnapshot: { id: refreshedEntry.id },
    basis: 'Image catalog entry created via API',
    entityType: 'imageCatalogEntry',
    entityId: refreshedEntry.id,
    namespace,
  });

  return { entry: await toEntryView(namespace, refreshedEntry, scope, daemon) };
}
