import type { ImageCatalogEntry } from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index';
import type { ImageCatalogEntryView } from '../../contract/image-catalog';
import { fetchDaemonImages, type DaemonImageListing } from '../system/_docker';
import { entryAvailability, resolveEntryVersions } from './_versions';
import { resolveCatalogLineage } from './_lineage';

/**
 * Annotate stored entries with the facts recomputed for this read.
 *
 * The daemon is asked once for the whole batch — for its image listing only,
 * never the disk statistics `getDockerInfo` also gathers, which nothing here
 * reads and which cost seconds. An unreachable daemon leaves every entry at
 * `availability: 'unknown'` with no versions rather than failing the request —
 * a catalog whose facts cannot be computed today still renders (AGENTS.md §13,
 * ADR-0021 decision 2).
 */
export async function toEntryViews(
  entries: readonly ImageCatalogEntry[],
  scope: CallerScope,
  catalog: readonly ImageCatalogEntry[] = entries,
  daemon?: DaemonImageListing,
): Promise<ImageCatalogEntryView[]> {
  const docker = daemon ?? (await fetchDaemonImages());
  const images = docker.available ? docker.images : [];

  // Lineage last: an entry's base is another entry, so it is resolved against
  // the whole namespace's catalog once every entry has its versions.
  return resolveCatalogLineage(
    entries.map((entry) => {
      const versions = resolveEntryVersions(entry.source, images, entry.capabilities);
      return {
        ...entry,
        versions,
        availability: entryAvailability(versions.length, docker.available),
      };
    }),
    images,
    catalog.map((entry) => ({
      id: entry.id,
      versions: resolveEntryVersions(entry.source, images),
    })),
  );
}

/**
 * One entry, annotated against the rest of its namespace's catalog.
 *
 * The extra read is what makes a single-entry response agree with the listing:
 * an entry's base is another entry, so answering `GET /image-catalog/:id` from
 * that entry alone would call every image a root.
 */
export async function toEntryView(
  namespace: string,
  entry: ImageCatalogEntry,
  scope: CallerScope,
  daemon?: DaemonImageListing,
): Promise<ImageCatalogEntryView> {
  const catalog = await scope.imageCatalog.list(namespace);
  const [view] = await toEntryViews([entry], scope, catalog, daemon);
  return view;
}
