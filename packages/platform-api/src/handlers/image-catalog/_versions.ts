import {
  catalogDockerfileKey,
  normalizeRepoPath,
  normalizeRepoUrls,
  unknownImageCapabilities,
  type ImageCapabilityCache,
  type ImageCatalogSource,
} from '@mediforce/platform-core';
import type { DockerImageInfo } from '../../contract/system';
import type {
  ImageCatalogAvailability,
  ImageCatalogVersion,
} from '../../contract/image-catalog';

/** A version before lineage: everything one image row says about itself.
 *  Lineage is the one fact that needs the *other* entries, so it is attached
 *  in `_lineage.ts` once they are all resolved. */
export type ResolvedVersion = Omit<ImageCatalogVersion, 'lineage'>;

/** A daemon row belongs to a built entry when its build labels name the same
 *  source. A step that named no Dockerfile carries no `mediforce.build.dockerfile`
 *  label at all — the builders label the value `deriveBuildTag` hashed, which is
 *  `dockerfile ?? ''` — so an absent label and the empty key value are the same
 *  fact and must compare equal here.
 *
 *  Both sides compare as `catalogDockerfileKey`, the Dockerfile's path from the
 *  repo root once a context is named, so a build of `container/Dockerfile` from
 *  the repo root is a version of the entry for `container/Dockerfile`.
 *
 *  The repo is normalised on both sides. An entry's is already canonical, but a
 *  label carries whatever reference the step author wrote, so an
 *  `https://github.com/…` build and a `git@github.com:….git` entry are the same
 *  source and used to resolve to zero versions. */
function matchesBuilt(image: DockerImageInfo, repo: string, dockerfileKey: string): boolean {
  if (image.buildRepo === undefined) return false;
  return (
    normalizeRepoUrls(image.buildRepo).gitUrl === repo &&
    catalogDockerfileKey(image.buildDockerfile ?? '', image.buildContext) === dockerfileKey
  );
}

/** A daemon row belongs to a carried entry when it was built from that
 *  workflow's carried files, for this namespace, from the same Dockerfile.
 *
 *  The context is not folded into the Dockerfile here as it is for a repo: a
 *  carried build always reads every carried file (`carriedDockerfile`), and a
 *  context label on an image is ignored.
 *
 *  The namespace is compared here and not for a built entry: a repo names the
 *  same files wherever it is built, while a workflow name is unique only inside
 *  its namespace, so without it two workspaces' `intake` workflows would offer —
 *  and could delete — each other's images. */
function matchesCarried(image: DockerImageInfo, namespace: string, workflow: string, dockerfile: string): boolean {
  if (image.buildArtifacts === undefined || image.buildDockerfile === undefined) return false;
  return (
    image.buildNamespace === namespace &&
    image.buildWorkflow === workflow &&
    (normalizeRepoPath(image.buildDockerfile) ?? image.buildDockerfile) === dockerfile
  );
}

/**
 * The versions of an entry, recomputed from the daemon listing.
 *
 * Nothing is stored: a version *is* an image on the daemon whose provenance
 * matches the entry's source, which is what makes two builds of one source at
 * different commits one entry with two versions (ADR-0022 decision 1) with no
 * write path at all.
 *
 * The daemon's own order is preserved — `docker images` returns newest first,
 * and inventing an order from the relative `created` string would be worse
 * than passing through the one the daemon already sorted.
 */
export function resolveEntryVersions(
  namespace: string,
  source: ImageCatalogSource,
  images: readonly DockerImageInfo[],
  capabilities: ImageCapabilityCache = {},
): ResolvedVersion[] {
  const matched = images.filter((image) => {
    switch (source.kind) {
      case 'built':
        return matchesBuilt(image, source.repo, catalogDockerfileKey(source.dockerfile, source.context));
      case 'referenced':
        return image.repository === source.reference;
      case 'carried':
        return matchesCarried(image, namespace, source.workflow, source.dockerfile);
    }
  });

  return matched.map((image) => ({
    imageTag: `${image.repository}:${image.tag}`,
    imageId: image.id,
    created: image.created,
    size: image.size,
    ...(image.buildCommit !== undefined ? { commit: image.buildCommit } : {}),
    ...(image.buildArtifacts !== undefined ? { contentHash: image.buildArtifacts } : {}),
    ...(image.buildWorkflow !== undefined ? { workflow: image.buildWorkflow } : {}),
    ...(image.buildNamespace !== undefined ? { namespace: image.buildNamespace } : {}),
    capabilities: capabilities[image.id] ?? unknownImageCapabilities(),
  }));
}

/**
 * Whether the entry's image is on the daemon — present, absent, or unknown.
 *
 * Unknown is a state, not an error (ADR-0022 decision 2): an unreachable
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
