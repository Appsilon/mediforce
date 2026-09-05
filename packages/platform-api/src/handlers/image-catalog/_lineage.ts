import { imageStepDelta, type ImageBuildStep } from '@mediforce/platform-core';
import type { DockerImageInfo } from '../../contract/system';
import type {
  ImageCatalogEntryView,
  ImageCatalogVersion,
  ImageCatalogVersionBase,
  ImageVersionLineage,
} from '../../contract/image-catalog';
import { fetchImageHistory } from '../system/_docker';
import type { ResolvedVersion } from './_versions';

/**
 * Lineage, at the level the catalog reads it.
 *
 * The daemon listing has already done the exact part — every image row carries
 * `baseImageId`, its nearest ancestor by `RootFS.Layers` prefix containment.
 * What is left here is the catalog's question: which *entry* is the nearest
 * ancestor, which is a walk up that chain until an image someone catalogued
 * turns up. Nothing in here knows the golden image by name; an entry for
 * `python3.12-slim` collects its derivatives exactly the same way.
 */

/** An entry view before lineage — what `_view.ts` can build without knowing
 *  about the other entries. */
export type EntryViewWithoutLineage = Omit<ImageCatalogEntryView, 'versions' | 'baseEntryId'> & {
  versions: readonly ResolvedVersion[];
};

/** The images a namespace has catalogued, entry by entry — what a base is
 *  resolved against. */
export interface CataloguedImages {
  id: string;
  versions: readonly { imageId: string; imageTag: string }[];
}

/** The catalogued version each image id belongs to. The tag comes from that
 *  version and not from the daemon listing, where one id collapses every tag it
 *  carries: a base catalogued as `base:v1` and also tagged `alias:latest` must
 *  be named the way the catalog names it.
 *
 *  Two entries *can* name one daemon image — two references to the same pushed
 *  image — and the later one in the catalog wins; the listing's order is
 *  stable, so the grouping is too, and naming both would leave nothing to group
 *  under. */
function catalogVersionByImageId(
  catalog: readonly CataloguedImages[],
): Map<string, ImageCatalogVersionBase> {
  return new Map(
    catalog.flatMap((entry) =>
      entry.versions.map((version): [string, ImageCatalogVersionBase] => [
        version.imageId,
        { entryId: entry.id, imageId: version.imageId, imageTag: version.imageTag },
      ]),
    ),
  );
}

/**
 * The nearest catalogued ancestor of an image, walking the daemon's chain.
 *
 * Each link is one image's immediate parent, so following them enumerates
 * every ancestor on the daemon nearest-first; the first one somebody
 * catalogued is the base. Walking rather than matching against the catalog
 * directly is what makes an uncatalogued image in the middle — a rebuilt
 * intermediate, a dangling layer — a hop instead of a wall.
 */
function nearestCatalogAncestor(
  imageId: string,
  imagesById: ReadonlyMap<string, DockerImageInfo>,
  catalogued: ReadonlyMap<string, ImageCatalogVersionBase>,
  selfEntryId: string,
): ImageCatalogVersionBase | null {
  const seen = new Set<string>([imageId]);
  let current = imagesById.get(imageId)?.baseImageId;

  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    const base = catalogued.get(current);
    // An entry is not its own base: two versions of one entry are two builds
    // of one source, and grouping an entry under itself would say nothing.
    if (base !== undefined && base.entryId !== selfEntryId) return base;
    current = imagesById.get(current)?.baseImageId;
  }

  return null;
}

function versionLineage(
  version: ResolvedVersion,
  entryId: string,
  imagesById: ReadonlyMap<string, DockerImageInfo>,
  catalogued: ReadonlyMap<string, ImageCatalogVersionBase>,
): ImageVersionLineage {
  return {
    base: nearestCatalogAncestor(version.imageId, imagesById, catalogued, entryId),
    ownLabels: imagesById.get(version.imageId)?.ownLabels ?? {},
  };
}

/**
 * Resolve every entry's base, and every version's, from the daemon listing.
 *
 * `catalog` is the whole namespace's catalog, which is not always the entries
 * being annotated: a base is *another entry*, so a single-entry read that only
 * knew about itself would report every entry a root.
 *
 * Free of daemon calls: the layers were read once for the listing and the rest
 * is arithmetic, which is why lineage runs on every read rather than being
 * cached the way capabilities are (ADR-0021 decision 2).
 */
export function resolveCatalogLineage(
  entries: readonly EntryViewWithoutLineage[],
  images: readonly DockerImageInfo[],
  catalog: readonly CataloguedImages[] = entries,
): ImageCatalogEntryView[] {
  const imagesById = new Map(images.map((image) => [image.id, image]));
  const catalogued = catalogVersionByImageId(catalog);

  return entries.map((entry) => {
    const versions: ImageCatalogVersion[] = entry.versions.map((version) => ({
      ...version,
      lineage: versionLineage(version, entry.id, imagesById, catalogued),
    }));
    return {
      ...entry,
      versions,
      // The newest version speaks for the entry: it is the build an author is
      // about to pick, and the daemon lists newest first.
      baseEntryId: versions[0]?.lineage.base?.entryId ?? null,
    };
  });
}

/**
 * Order entries so each one follows the entry it was built on, roots first.
 *
 * Depth-first from every root, preserving the incoming order within a group,
 * so the catalog reads as the tree it is — "the golden image, then everything
 * built on it" — instead of as unrelated rows. An entry whose base is missing
 * from this listing is a root here; a cycle, which layer containment makes
 * impossible, would leave its members at the end rather than dropping them.
 */
export function orderByLineage(entries: readonly ImageCatalogEntryView[]): ImageCatalogEntryView[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const children = new Map<string, ImageCatalogEntryView[]>();
  for (const entry of entries) {
    if (entry.baseEntryId === null || !byId.has(entry.baseEntryId)) continue;
    children.set(entry.baseEntryId, [...(children.get(entry.baseEntryId) ?? []), entry]);
  }

  const ordered: ImageCatalogEntryView[] = [];
  const emitted = new Set<string>();

  const emit = (entry: ImageCatalogEntryView): void => {
    if (emitted.has(entry.id)) return;
    emitted.add(entry.id);
    ordered.push(entry);
    for (const child of children.get(entry.id) ?? []) emit(child);
  };

  for (const entry of entries) {
    if (entry.baseEntryId === null || !byId.has(entry.baseEntryId)) emit(entry);
  }
  for (const entry of entries) emit(entry);

  return ordered;
}

/**
 * Wall-clock budget for one entry's whole summary. Each `docker history` is
 * bounded on its own, but an entry accumulates a version per build: on a slow
 * daemon a ten-version entry would otherwise pay ten timeouts in a row and hold
 * the read open for minutes. Past the budget the remaining versions report the
 * summary as unavailable — exactly what an unreachable daemon reports — and the
 * next read, against a daemon that has recovered, computes them.
 */
const BUILD_STEPS_BUDGET_MS = 20_000;

/**
 * Attach each version's layer delta — the steps it adds over its base.
 *
 * One `docker history` call per distinct image, which is why this runs on a
 * single-entry read and not on the listing: an entry accumulates a version per
 * build, and a workspace's whole catalog would be a call per version on every
 * page load. A daemon that cannot answer leaves the steps absent, never an
 * error (ADR-0021 decision 2).
 */
export async function withBuildSteps(
  entry: ImageCatalogEntryView,
): Promise<ImageCatalogEntryView> {
  const history = new Map<string, ImageBuildStep[] | null>();
  const deadline = Date.now() + BUILD_STEPS_BUDGET_MS;
  // Read by immutable id, never by tag: a tag like `latest` can be moved
  // between the listing that resolved this version and this call, and the delta
  // would then summarise a different artifact.
  const stepsFor = async (imageId: string): Promise<ImageBuildStep[] | null> => {
    const cached = history.get(imageId);
    if (cached !== undefined) return cached;
    const steps = Date.now() >= deadline ? null : await fetchImageHistory(imageId);
    history.set(imageId, steps);
    return steps;
  };

  const versions: ImageCatalogVersion[] = [];
  for (const version of entry.versions) {
    const steps = await stepsFor(version.imageId);
    const baseSteps =
      version.lineage.base === null ? [] : await stepsFor(version.lineage.base.imageId);
    versions.push({
      ...version,
      // Absent, not empty, unless both reads answered: a base whose history the
      // daemon could not produce reads as contributing nothing, which would
      // publish every step the image inherited as one it added.
      lineage:
        steps === null || baseSteps === null
          ? version.lineage
          : { ...version.lineage, addedSteps: imageStepDelta(steps, baseSteps) },
    });
  }

  return { ...entry, versions };
}
