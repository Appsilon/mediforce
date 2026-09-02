import type { ImageCatalogEntry } from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index';
import type { ImageCatalogEntryView } from '../../contract/image-catalog';
import { getDockerInfo } from '../system/get-docker-info';
import { entryAvailability, resolveEntryVersions } from './_versions';

/**
 * Annotate stored entries with the facts recomputed for this read.
 *
 * The daemon is asked once for the whole batch, and an unreachable one leaves
 * every entry at `availability: 'unknown'` with no versions rather than
 * failing the request — a catalog whose facts cannot be computed today still
 * renders (AGENTS.md §13, ADR-0021 decision 2).
 */
export async function toEntryViews(
  entries: readonly ImageCatalogEntry[],
  scope: CallerScope,
): Promise<ImageCatalogEntryView[]> {
  const docker = await getDockerInfo({}, scope);
  const images = docker.available ? docker.images : [];

  return entries.map((entry) => {
    const versions = resolveEntryVersions(entry.source, images, entry.capabilities);
    return {
      ...entry,
      versions,
      availability: entryAvailability(versions.length, docker.available),
    };
  });
}
