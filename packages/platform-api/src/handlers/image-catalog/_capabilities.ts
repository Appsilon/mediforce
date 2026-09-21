import {
  unknownImageCapabilities,
  type ImageCapabilities,
  type ImageCapabilityCache,
  type ImageCatalogEntry,
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

  const versions = resolveEntryVersions(namespace, entry.source, docker.images);
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
    // Another workspace already paid for this image: copy its answer to the
    // row rather than start a container for the same question.
    const memoised = probedImages.get(version.imageId)?.capabilities;
    if (memoised?.status === 'known') {
      probed[version.imageId] = memoised;
      continue;
    }
    if (Date.now() >= deadline) break;
    probed[version.imageId] = await probeImage(version.imageId, version.imageTag);
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
 * Every probe this process has run, keyed by the daemon's image id.
 *
 * The answer depends on the image and nothing else — not the workspace, not the
 * entry — and the key is content-addressed, so it cannot go stale: a rebuild
 * mints a different id. That makes one probe enough for every workspace whose
 * catalog holds the image. Rows are per workspace, so without this a default
 * image seeded into fifty workspaces (ADR-0022 decision 8) waited for someone to
 * open it in each of them, and waited again after every rebuild.
 *
 * It also holds what no row can: the versions of a discovered entry, which is
 * derived on read (decision 7). Losing it on restart costs one probe per image.
 */
interface ProbeRecord {
  readonly capabilities: ImageCapabilities;
  readonly probedAt: number;
}
const probedImages = new Map<string, ProbeRecord>();

/** Bounded by the daemon's image count in practice; capped anyway so a daemon
 *  churning through thousands of tags cannot grow it without limit. Oldest
 *  first, which is insertion order — a `Map` keeps it. */
const PROBE_MEMO_LIMIT = 512;

/** How long a failed probe stands before the listing tries that image again.
 *  Long enough that an image the probe cannot run is not a container start on
 *  every 30 s poll; short enough that a worker which was briefly down heals. */
const FAILED_PROBE_RETRY_MS = 10 * 60 * 1000;

async function probeImage(imageId: string, imageTag: string): Promise<ImageCapabilities> {
  // `probeImageCapabilities` answers `unknown` rather than throwing; a throw is
  // recorded as the same answer, so it waits out the retry window like one.
  const capabilities = await probeImageCapabilities(imageTag).catch(() => unknownImageCapabilities());
  probedImages.delete(imageId);
  if (probedImages.size >= PROBE_MEMO_LIMIT) {
    const oldest = probedImages.keys().next();
    if (oldest.done === false) probedImages.delete(oldest.value);
  }
  probedImages.set(imageId, { capabilities, probedAt: Date.now() });
  return capabilities;
}

/**
 * The entry with every `known` answer this process holds for its versions laid
 * over the ones its row lacks — no probe, no daemon call, just the memo.
 *
 * What both reads render through, for a stored entry and a discovered one: a
 * probe run from another workspace answers this one too.
 */
export function withProbedCapabilities(
  namespace: string,
  entry: ImageCatalogEntry,
  images: readonly DockerImageInfo[],
): ImageCatalogEntry {
  const capabilities: ImageCapabilityCache = { ...entry.capabilities };
  for (const version of resolveEntryVersions(namespace, entry.source, images)) {
    if (capabilities[version.imageId]?.status === 'known') continue;
    const memoised = probedImages.get(version.imageId);
    if (memoised !== undefined) capabilities[version.imageId] = memoised.capabilities;
  }
  return { ...entry, capabilities };
}

/**
 * Probe a discovered entry's versions, the way `refreshEntryCapabilities`
 * probes a stored one — same budget, same "only what was never attempted"
 * rule, memo instead of a row.
 *
 * Called from the single-entry read for the same reason that one probes a
 * stored entry: it is user-initiated and one entry at a time, so the answer is
 * in the response rather than on the next poll.
 */
export async function probeDiscoveredCapabilities(
  namespace: string,
  entry: ImageCatalogEntry,
  images: readonly DockerImageInfo[],
): Promise<ImageCapabilityCache> {
  const deadline = Date.now() + CAPABILITY_REFRESH_BUDGET_MS;

  for (const version of resolveEntryVersions(namespace, entry.source, images)) {
    if (probedImages.has(version.imageId)) continue;
    if (Date.now() >= deadline) break;
    await probeImage(version.imageId, version.imageTag);
  }

  return withProbedCapabilities(namespace, entry, images).capabilities;
}

/** Image ids queued or running in the background, so two listings polled at
 *  once — two tabs, two users, two workspaces — never queue one image twice. */
const pendingProbes = new Set<string>();
/** One probe at a time: each is a container start on the shared host, and a
 *  catalog opened after a deploy must not start one per image at once. */
let probeQueue: Promise<void> = Promise.resolve();

/**
 * Queue a probe for every version the listing is about to show without an
 * answer, and return at once — the listing never waits for a container.
 *
 * The next poll shows the result, from the memo. An image is queued when no
 * answer exists anywhere, or when its last probe failed long enough ago to be
 * worth one more container; a `known` answer is final for its id.
 */
export function probeInBackground(
  namespace: string,
  entries: readonly ImageCatalogEntry[],
  images: readonly DockerImageInfo[],
): void {
  for (const entry of entries) {
    for (const version of resolveEntryVersions(namespace, entry.source, images, entry.capabilities)) {
      if (version.capabilities.status === 'known') continue;
      if (pendingProbes.has(version.imageId)) continue;
      const previous = probedImages.get(version.imageId);
      if (previous !== undefined && Date.now() - previous.probedAt < FAILED_PROBE_RETRY_MS) continue;

      pendingProbes.add(version.imageId);
      probeQueue = probeQueue.then(async () => {
        try {
          await probeImage(version.imageId, version.imageTag);
        } finally {
          pendingProbes.delete(version.imageId);
        }
      });
    }
  }
}

/** Whether a version without an answer is still waiting for one — queued, or
 *  never attempted by this process nor by the row — rather than probed and
 *  failed. */
export function isProbePending(imageId: string, cached: ImageCapabilities | undefined): boolean {
  return pendingProbes.has(imageId) || (!probedImages.has(imageId) && cached === undefined);
}
