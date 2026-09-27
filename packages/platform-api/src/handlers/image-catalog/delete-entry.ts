import { isImageVersionOwnedBy } from '@mediforce/platform-core';
import { assertCallerIsNamespaceAdmin, assertNamespaceAccess } from '../../auth';
import type { CallerScope } from '../../repositories/index';
import type {
  DeleteImageCatalogEntryInput,
  DeleteImageCatalogEntryOutput,
} from '../../contract/image-catalog';
import { actorFromCaller } from '../_helpers';
import { assertNoLiveImagePins } from '../workflows/_image-pins';
import { deleteDockerImage } from '../docker-images/delete-image';
import { fetchDaemonImages } from '../system/_docker';
import { discoverEntries } from './_discovered';
import { resolveEntryVersions } from './_versions';

export async function deleteImageCatalogEntry(
  input: DeleteImageCatalogEntryInput,
  scope: CallerScope,
): Promise<DeleteImageCatalogEntryOutput> {
  assertNamespaceAccess(scope.caller, input.namespace);
  // Admin or owner of this workspace, for the whole delete and not only its
  // image half. An entry exists *for* the images behind it, so a record-only
  // delete is not a lesser act with a lighter gate — for anything this
  // namespace built it is barely an act at all, since the row is re-derived on
  // the next read (ADR-0022 decision 7). Creating stays a member's right; the
  // asymmetry is deliberate and recorded in the ADR.
  assertCallerIsNamespaceAdmin(scope.caller, input.namespace);

  // Fetch-before-delete only so an idempotent no-op does not emit a
  // misleading audit entry.
  const existing = await scope.imageCatalog.getById(input.namespace, input.id);

  const deletedImages: string[] = [];
  const keptImages: string[] = [];
  if (input.withImages === true) {
    // The daemon is deployment-wide, so even an image this workspace produced
    // may back steps in other namespaces.
    //
    // The gate above already asserted admin of this workspace, which is
    // stricter than the one `deleteDockerImage` applies underneath: that one is
    // documented as a loose approximation — owner or admin of *any* namespace —
    // which nearly every user satisfies through their own personal workspace.
    // The *live-pin* refusal is the same on both paths, and asked below.

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
      return { success: true, deletedImages, keptImages };
    }

    // Only what this workspace produced leaves the daemon. The rest — an image
    // catalogued through **Existing image**, another workspace's build of the
    // same repo, an engine default a step that names no image falls back to —
    // stays, and the entry goes without it: the delete removes this
    // workspace's offer, never another's capability.
    const versions = resolveEntryVersions(input.namespace, source, daemon.images);
    const owned = versions.filter((version) => isImageVersionOwnedBy(input.namespace, source, version));
    const ownedTags = new Set(owned.map((version) => version.imageTag));
    keptImages.push(
      ...new Set(versions.map((version) => version.imageTag).filter((tag) => ownedTags.has(tag) === false)),
    );
    // By tag, not by image id. A tag names exactly what this entry offered, so
    // an image a second tag still references survives — where `docker rmi` on
    // a shared id refuses outright and forcing it would delete a version some
    // other entry offers. Deduplicated because two versions can share a tag
    // only by naming the same artifact twice.
    const tags = [...ownedTags];

    // `deleteDockerImage` asks this of every tag it is handed, so the rule and
    // its message live in one place. Asked here too, over all of them at once,
    // because the loop below destroys tags one at a time: leave it to the call
    // underneath and a refusal on the second tag arrives with the first one
    // already gone. A refused delete destroys nothing.
    await assertNoLiveImagePins(tags, scope);

    // Images first, and every one of them: the entry is the only handle anyone
    // has on what is left behind, so removing the row while a tag survives
    // orphans an artifact under a name nobody wrote. A failure here leaves the
    // entry intact and the caller able to retry or to delete the offer alone.
    for (const tag of tags) {
      // The admin handler, not the service: one code path for destroying an
      // image, so this cannot drift from Infrastructure's own delete on the
      // gate, the `_system` audit, the live-pin refusal or the
      // unconfigured-deployment error.
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
      outputSnapshot: { id: input.id, deletedImages, keptImages },
      basis: 'Image catalog entry deleted via API',
      entityType: 'imageCatalogEntry',
      entityId: input.id,
      namespace: input.namespace,
    });
  }

  return { success: true, deletedImages, keptImages };
}
