import { assertCallerIsNamespaceAdmin, assertNamespaceAccess } from '../../auth';
import type { CallerScope } from '../../repositories/index';
import type {
  DeleteImageCatalogEntryInput,
  DeleteImageCatalogEntryOutput,
} from '../../contract/image-catalog';
import { actorFromCaller } from '../_helpers';
import { deleteDockerImage } from '../docker-images/delete-image';
import { fetchDaemonImages } from '../system/_docker';
import { discoverEntries } from './_discovered';
import { resolveEntryVersions } from './_versions';

export async function deleteImageCatalogEntry(
  input: DeleteImageCatalogEntryInput,
  scope: CallerScope,
): Promise<DeleteImageCatalogEntryOutput> {
  assertNamespaceAccess(scope.caller, input.namespace);

  // Deleting an entry removes an offer, never a capability: no Workflow
  // Definition points at one, so no run changes behaviour (ADR-0022
  // decision 3). Fetch-before-delete only so an idempotent no-op does not
  // emit a misleading audit entry.
  const existing = await scope.imageCatalog.getById(input.namespace, input.id);

  const deletedImages: string[] = [];
  if (input.withImages === true) {
    // The image half is a different act under a different gate — the daemon is
    // deployment-wide, so this destroys artifacts steps in other namespaces may
    // pin. Asserted up front: a caller who may not delete images must not get a
    // half-done delete either.
    //
    // Admin **of this workspace**, which is stricter than the gate
    // `deleteDockerImage` applies underneath: that one is documented as a loose
    // approximation — owner or admin of *any* namespace — which nearly every
    // user satisfies through their own personal workspace. Inheriting it here
    // would make "admin-gated" a claim this code does not keep, and it is also
    // exactly what the dialog offers, so the two would disagree.
    assertCallerIsNamespaceAdmin(scope.caller, input.namespace);

    const daemon = await fetchDaemonImages();
    // A discovered entry is derived on read rather than stored (ADR-0022
    // decision 7), so its images are the only thing there is to delete —
    // resolved the way `getImageCatalogEntry` resolves it, rather than reading
    // a missing row as nothing to do.
    let source = existing?.source;
    if (source === undefined) {
      const stored = await scope.imageCatalog.list(input.namespace);
      const images = daemon.available ? daemon.images : [];
      source = discoverEntries(input.namespace, images, stored).find(
        (candidate) => candidate.id === input.id,
      )?.source;
    }
    if (source === undefined) {
      // Neither a row nor an image the platform built for this namespace.
      // Deleting is idempotent, so this is a no-op rather than a 404.
      return { success: true, deletedImages };
    }

    const versions = resolveEntryVersions(source, daemon.images);
    // By tag, not by image id. A tag names exactly what this entry offered, so
    // an image a second tag still references survives — where `docker rmi` on
    // a shared id refuses outright and forcing it would delete a version some
    // other entry offers. Deduplicated because two versions can share a tag
    // only by naming the same artifact twice.
    const tags = [...new Set(versions.map((version) => version.imageTag))];

    // Images first, and every one of them: the entry is the only handle anyone
    // has on what is left behind, so removing the row while a tag survives
    // orphans an artifact under a name nobody wrote. A failure here leaves the
    // entry intact and the caller able to retry or to delete the offer alone.
    for (const tag of tags) {
      // The admin handler, not the service: one code path for destroying an
      // image, so this cannot drift from Infrastructure's own delete on the
      // gate, the `_system` audit or the unconfigured-deployment error.
      await deleteDockerImage({ imageId: tag }, scope);
      deletedImages.push(tag);
    }
  }

  await scope.imageCatalog.delete(input.namespace, input.id);

  if (existing !== null) {
    const actor = actorFromCaller(scope);
    await scope.system.audit.append({
      ...actor,
      action: 'image_catalog_entry.deleted',
      description:
        deletedImages.length === 0
          ? `Image catalog entry '${input.id}' deleted from namespace '${input.namespace}'`
          : `Image catalog entry '${input.id}' deleted from namespace '${input.namespace}', with ${String(deletedImages.length)} image(s) removed from the daemon`,
      timestamp: new Date().toISOString(),
      inputSnapshot: {
        namespace: input.namespace,
        id: input.id,
        withImages: input.withImages === true,
      },
      outputSnapshot: { id: input.id, deletedImages },
      basis: 'Image catalog entry deleted via API',
      entityType: 'imageCatalogEntry',
      entityId: input.id,
      namespace: input.namespace,
    });
  }

  return { success: true, deletedImages };
}
