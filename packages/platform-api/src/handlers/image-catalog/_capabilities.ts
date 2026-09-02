import type { ImageCapabilityCache, ImageCatalogEntry } from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index';
import { getDockerInfo } from '../system/get-docker-info';
import { probeImageCapabilities } from '../system/_docker';
import { resolveEntryVersions } from './_versions';

/**
 * Wall-clock budget for one entry's whole refresh. Each probe is bounded on its
 * own, but an entry accumulates a version per build: without this an entry with
 * ten unreachable versions would hold create/update open for ten timeouts. Past
 * the budget the remaining versions stay uncached — they read as `unknown` and
 * the next create/update picks them up, since a `known` result is never
 * re-probed.
 */
const CAPABILITY_REFRESH_BUDGET_MS = 20_000;

export async function refreshEntryCapabilities(
  namespace: string,
  entry: ImageCatalogEntry,
  scope: CallerScope,
): Promise<ImageCatalogEntry> {
  const docker = await getDockerInfo({}, scope);
  if (!docker.available) return entry;

  const versions = resolveEntryVersions(entry.source, docker.images);
  const deadline = Date.now() + CAPABILITY_REFRESH_BUDGET_MS;
  const probed: ImageCapabilityCache = {};

  for (const version of versions) {
    if (entry.capabilities[version.imageId]?.status === 'known') continue;
    if (Date.now() >= deadline) break;
    probed[version.imageId] = await probeImageCapabilities(version.imageTag);
  }

  if (Object.keys(probed).length === 0) return entry;

  // Re-read before writing: `entry` is a snapshot from before the probes, and a
  // concurrent edit of the same entry landed in between would be erased by
  // writing that snapshot back. Only the capability cache travels from here.
  const current = await scope.imageCatalog.getById(namespace, entry.id) ?? entry;
  return scope.imageCatalog.upsert(namespace, {
    ...current,
    capabilities: { ...current.capabilities, ...probed },
  });
}
