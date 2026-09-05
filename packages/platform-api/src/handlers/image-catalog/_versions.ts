import type { ImageCatalogSource } from '@mediforce/platform-core';
import type { DockerImageInfo } from '../../contract/system';
import type {
  ImageCatalogAvailability,
  ImageCatalogVersion,
} from '../../contract/image-catalog';

/** A daemon row belongs to a built entry when its build labels name the same
 *  source. A step that named no Dockerfile carries no `mediforce.build.dockerfile`
 *  label at all — the builders label the value `deriveBuildTag` hashed, which is
 *  `dockerfile ?? ''` — so an absent label and the empty key value are the same
 *  fact and must compare equal here. */
function matchesBuilt(image: DockerImageInfo, repo: string, dockerfile: string): boolean {
  return image.buildRepo === repo && (image.buildDockerfile ?? '') === dockerfile;
}

/**
 * The versions of an entry, recomputed from the daemon listing.
 *
 * Nothing is stored: a version *is* an image on the daemon whose provenance
 * matches the entry's source, which is what makes two builds of one source at
 * different commits one entry with two versions (ADR-0021 decision 1) with no
 * write path at all.
 *
 * The daemon's own order is preserved — `docker images` returns newest first,
 * and inventing an order from the relative `created` string would be worse
 * than passing through the one the daemon already sorted.
 */
export function resolveEntryVersions(
  source: ImageCatalogSource,
  images: readonly DockerImageInfo[],
): ImageCatalogVersion[] {
  const matched =
    source.kind === 'built'
      ? images.filter((image) => matchesBuilt(image, source.repo, source.dockerfile))
      : images.filter((image) => image.repository === source.reference);

  return matched.map((image) => ({
    imageTag: `${image.repository}:${image.tag}`,
    imageId: image.id,
    created: image.created,
    size: image.size,
    ...(image.buildCommit !== undefined ? { commit: image.buildCommit } : {}),
    ...(image.buildWorkflow !== undefined ? { workflow: image.buildWorkflow } : {}),
    ...(image.buildNamespace !== undefined ? { namespace: image.buildNamespace } : {}),
  }));
}

/**
 * Whether the entry's image is on the daemon — present, absent, or unknown.
 *
 * Unknown is a state, not an error (ADR-0021 decision 2): an unreachable
 * daemon must not turn a catalog read into a 500 or an empty list, so the
 * entry still lists and says only that nobody could check.
 */
export function entryAvailability(
  versionCount: number,
  daemonAvailable: boolean,
): ImageCatalogAvailability {
  if (!daemonAvailable) return 'unknown';
  return versionCount > 0 ? 'present' : 'absent';
}
