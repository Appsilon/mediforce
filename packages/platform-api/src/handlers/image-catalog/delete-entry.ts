import {
  assertCallerIsNamespaceAdmin,
  assertNamespaceAccess,
  type CallerIdentity,
} from '../../auth';
import { ConflictError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type {
  DeleteImageCatalogEntryInput,
  DeleteImageCatalogEntryOutput,
} from '../../contract/image-catalog';
import { actorFromCaller } from '../_helpers';
import { findWorkflowImagePins, type WorkflowImagePin } from '../workflows/_image-pins';
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
  if (input.withImages === true) {
    // The daemon is deployment-wide, so this destroys artifacts that steps in
    // other namespaces may pin.
    //
    // The gate above already asserted admin of this workspace, which is
    // stricter than the one `deleteDockerImage` applies underneath: that one is
    // documented as a loose approximation — owner or admin of *any* namespace —
    // which nearly every user satisfies through their own personal workspace.

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

    // A live version pinning one of these tags is a run that will fail at
    // container start, and unlike a superseded version its author can still
    // re-point it — so this refuses rather than breaking it. Judged
    // deployment-wide, because the daemon is: a step in a namespace this caller
    // cannot read breaks just the same.
    const pins = findWorkflowImagePins(
      await scope.workflowDefinitions.listGroupsForImageAudit(),
      tags,
    );
    const live = pins.filter((pin) => pin.live);
    if (live.length > 0) {
      throw new ConflictError(describeLivePins(live, scope.caller));
    }

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

/**
 * Why a delete was refused, in terms the caller can act on.
 *
 * Redacted, because the scan behind it is deployment-wide while workflow names
 * are not: a private workflow in a namespace this caller has not joined is
 * counted, never named. The count still has to be there — a block with no
 * reason is indistinguishable from a bug.
 */
function describeLivePins(live: readonly WorkflowImagePin[], caller: CallerIdentity): string {
  const visible = live.filter(
    (pin) =>
      caller.isSystemActor || caller.namespaces.has(pin.namespace) || pin.visibility === 'public',
  );
  const hidden = live.length - visible.length;

  const named = visible.map(
    (pin) => `${pin.namespace}/${pin.name} v${String(pin.version)} (${pin.steps.join(', ')})`,
  );
  if (hidden > 0) {
    named.push(
      `${String(hidden)} more in ${hidden === 1 ? 'a workspace' : 'workspaces'} you cannot see`,
    );
  }

  return (
    `Cannot delete these images: ${String(live.length)} workflow ${live.length === 1 ? 'version' : 'versions'} ` +
    `still ${live.length === 1 ? 'runs' : 'run'} on ${live.length === 1 ? 'it' : 'them'} — ${named.join('; ')}. ` +
    'Point those steps at another image, or archive the version, then delete again. ' +
    'Superseded and archived versions do not block, since a registered version cannot be re-pointed.'
  );
}
