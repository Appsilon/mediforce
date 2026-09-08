import type {
  ImageCapabilities,
  ImageCapabilityCache,
  ImageCatalogEntry,
} from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index';
import type { DockerImageInfo } from '../../contract/system';
import {
  fetchDaemonImages,
  probeImageCapabilities,
  type DaemonImageListing,
} from '../system/_docker';
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
  daemon?: DaemonImageListing,
  options?: { unattemptedOnly?: boolean },
): Promise<ImageCatalogEntry> {
  // A caller that has already read the daemon passes it in: a create or update
  // would otherwise pay for two reads of the same listing.
  const docker = daemon ?? (await fetchDaemonImages());
  if (!docker.available) return entry;

  const versions = resolveEntryVersions(entry.source, docker.images);
  const deadline = Date.now() + CAPABILITY_REFRESH_BUDGET_MS;
  const probed: ImageCapabilityCache = {};

  for (const version of versions) {
    // Two different questions, because the callers ask for different reasons.
    // A write re-probes anything not `known`: someone edited the entry, and
    // retrying an image that failed last time is what they are there for. A
    // read probes only what has never been attempted — an image whose probe
    // already answered `unknown` would otherwise be re-probed on every poll,
    // turning an unprobeable image into a container start every 30 seconds.
    const cached = entry.capabilities[version.imageId];
    const settled = options?.unattemptedOnly === true
      ? cached !== undefined
      : cached?.status === 'known';
    if (settled) continue;
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

/**
 * Probe results for images no row can hold — the versions of a discovered
 * entry, which is derived on read and therefore has nowhere to store them
 * (ADR-0022 decision 7).
 *
 * A memo rather than a cache: the key is the daemon's immutable, content-
 * addressed image id, so an answer for that id cannot go stale — a rebuild
 * mints a different id, and the entry that owns it gets a different question.
 * There is no TTL for the same reason. Losing it on restart costs one probe
 * per image the next time somebody opens the entry.
 *
 * An `unknown` answer is memoised too, exactly as `unattemptedOnly` records one
 * on a row: an image the probe cannot answer for must not start a container
 * again on the next poll of the card that is already open.
 */
const discoveredProbes = new Map<string, ImageCapabilities>();

/** Bounded by the daemon's image count in practice; capped anyway so a daemon
 *  churning through thousands of tags cannot grow it without limit. Oldest
 *  first, which is insertion order — a `Map` keeps it. */
const DISCOVERED_PROBE_MEMO_LIMIT = 512;

function memoise(imageId: string, capabilities: ImageCapabilities): void {
  if (discoveredProbes.size >= DISCOVERED_PROBE_MEMO_LIMIT) {
    const oldest = discoveredProbes.keys().next();
    if (oldest.done === false) discoveredProbes.delete(oldest.value);
  }
  discoveredProbes.set(imageId, capabilities);
}

/**
 * What has already been probed for a discovered entry's versions — no probe,
 * no daemon call, just the memo.
 *
 * This is what the listing reads. It never probes, for a discovered entry or a
 * catalogued one, because that would start a container per version on a 30 s
 * poll; but showing an answer somebody's earlier read already paid for is free.
 */
export function memoisedCapabilities(
  entry: ImageCatalogEntry,
  images: readonly DockerImageInfo[],
): ImageCapabilityCache {
  const cache: ImageCapabilityCache = {};
  for (const version of resolveEntryVersions(entry.source, images)) {
    const memoised = discoveredProbes.get(version.imageId);
    if (memoised !== undefined) cache[version.imageId] = memoised;
  }
  return cache;
}

/**
 * Probe a discovered entry's versions, the way `refreshEntryCapabilities`
 * probes a stored one — same budget, same "only what was never attempted"
 * rule, memo instead of a row.
 *
 * Called from the single-entry read for the same reason that one probes a
 * stored entry: it is user-initiated and one entry at a time. Without it a
 * discovered entry would be the one thing in the catalog that never fills in
 * its own derived facts, which is the opposite of what makes it derived.
 */
export async function probeDiscoveredCapabilities(
  entry: ImageCatalogEntry,
  images: readonly DockerImageInfo[],
): Promise<ImageCapabilityCache> {
  const deadline = Date.now() + CAPABILITY_REFRESH_BUDGET_MS;

  for (const version of resolveEntryVersions(entry.source, images)) {
    if (discoveredProbes.has(version.imageId)) continue;
    if (Date.now() >= deadline) break;
    memoise(version.imageId, await probeImageCapabilities(version.imageTag));
  }

  return memoisedCapabilities(entry, images);
}
