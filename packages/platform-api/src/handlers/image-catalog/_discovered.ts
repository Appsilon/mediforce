import {
  BuildContextSchema,
  normalizeRepoUrls,
  type ImageCatalogEntry,
} from '@mediforce/platform-core';
import type { DockerImageInfo } from '../../contract/system';
import { canonicalizeSource, deriveImageCatalogEntryId } from './_source';

/**
 * An entry in every respect but the sentence.
 *
 * Everything on it is derived from the image the platform built — the source
 * key, the versions, the lineage — because the build labelled all of it
 * (`mediforce.build.*`). What no build can write is `intent`, the one field
 * ADR-0022 decision 2 reserves for a human, so it is empty here and a
 * discovered entry stays out of the table until somebody fills it in.
 */
export type DiscoveredEntry = Omit<ImageCatalogEntry, 'intent'> & { intent: '' };

/**
 * A build repo that is a filesystem path rather than a remote.
 *
 * Nothing else can rebuild it and the path is usually already gone by the time
 * anyone reads the catalog — it is build residue from a test or a scratch
 * checkout, not an image a workspace offers.
 */
function isLocalPathRepo(repo: string): boolean {
  return repo.startsWith('.') || repo.startsWith('/') || repo.startsWith('file://');
}

/** The last path segment of a repo URL: `git@github.com:Appsilon/tealflow.git`
 *  → `tealflow`. A suggestion the person describing the entry can overwrite,
 *  which is why it is the repo name and not an invented sentence. */
function suggestedName(repo: string): string {
  return (repo.split('/').pop() ?? repo).replace(/\.git$/, '');
}

/**
 * The sources this namespace built images from that nobody has described yet.
 *
 * The platform labels every image it builds with the repo, Dockerfile and
 * namespace that produced it, so the catalog can offer those sources without
 * anybody enrolling them by hand — which is the gap that left a workspace
 * looking at "no images catalogued yet" the day after its first build.
 *
 * Derived on read, never stored: a discovered entry holds nothing a human
 * wrote, so persisting it would buy a row that has to be garbage-collected
 * when its image goes and would turn a polled listing into a write path.
 * Describing one is an ordinary `POST` — and because the id is derived from
 * the source, the row it creates lands at the id the discovered entry already
 * had (ADR-0022 decision 1).
 *
 * Three images are deliberately not offered: one built for another namespace
 * (the build recorded which one), one the platform did not build (`postgres`,
 * a dangling layer — no build labels at all), and one built from a local path.
 * The first two fall out of the rule rather than needing a blocklist.
 */
export function discoverEntries(
  namespace: string,
  images: readonly DockerImageInfo[],
  catalogued: readonly ImageCatalogEntry[],
): DiscoveredEntry[] {
  const known = new Set(catalogued.map((entry) => deriveImageCatalogEntryId(entry.source)));
  const discovered = new Map<string, DiscoveredEntry>();

  for (const image of images) {
    const repo = image.buildRepo;
    if (repo === undefined || image.buildNamespace !== namespace) continue;
    if (isLocalPathRepo(repo)) continue;

    const source = canonicalizeSource({
      kind: 'built',
      repo,
      // An absent label and the empty key value are the same fact: the builders
      // label what `deriveBuildTag` hashed, which is `dockerfile ?? ''`.
      dockerfile: image.buildDockerfile ?? '',
      // The daemon lists newest first, so the first build seen names the
      // context the entry's Build action should reproduce. A label anyone
      // could have written is checked first: the contract refuses an escaping
      // context, and one such entry would fail the whole listing.
      context: BuildContextSchema.safeParse(image.buildContext).success ? image.buildContext : undefined,
    });
    const id = deriveImageCatalogEntryId(source);
    if (known.has(id) || discovered.has(id)) continue;

    discovered.set(id, {
      id,
      name: suggestedName(normalizeRepoUrls(repo).gitUrl),
      intent: '',
      source,
      capabilities: {},
    });
  }

  return [...discovered.values()];
}
