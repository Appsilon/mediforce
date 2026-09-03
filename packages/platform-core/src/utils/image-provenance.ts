/**
 * Build provenance carried on the images the platform builds.
 *
 * A build-mode step that omits `image` runs under a tag derived from its build
 * inputs (`mediforce-built:<12 hex>`), so the tag itself says nothing about
 * which repo, commit or Dockerfile produced it. The builder writes that
 * provenance as image labels; the daemon listing reads it back. Pure strings,
 * shared so both builders emit the same keys the listing looks for.
 */

import { z } from 'zod';
import { normalizeRepoUrls, redactRepoCredentials } from './repo-url';

/** Label keys the platform writes on every image it builds. */
export const BUILD_LABELS = {
  repo: 'mediforce.build.repo',
  commit: 'mediforce.build.commit',
  dockerfile: 'mediforce.build.dockerfile',
  workflow: 'mediforce.build.workflow',
  namespace: 'mediforce.build.namespace',
} as const;

/**
 * Standard OCI keys, emitted alongside the `mediforce.build.*` ones.
 *
 * Not redundant: they are what the rest of the ecosystem reads, and — because
 * labels are inherited from the base image — leaving them unset makes our
 * images report the base's repository as their own. An image built on
 * `rocker/tidyverse` claims `org.opencontainers.image.source =
 * https://github.com/rocker-org/rocker-versioned2` until we override it.
 */
export const OCI_LABELS = {
  source: 'org.opencontainers.image.source',
  revision: 'org.opencontainers.image.revision',
} as const;

export interface ImageProvenance {
  /** Normalized git URL of the build context repo. */
  repoUrl: string;
  commit: string;
  /** Dockerfile path inside the repo, as the build resolved it. */
  dockerfile: string;
  /** Workflow definition whose step triggered the build. */
  workflow?: string;
  /** Namespace owning that definition. */
  namespace?: string;
  /** Clone token — used only to keep it out of the labels, never written. */
  repoToken?: string;
}

/**
 * `--label` arguments for `docker build`, one flag pair per known fact.
 *
 * Labels are immutable and travel with the image, so the repo URL is redacted
 * before it goes in: an authenticated HTTPS reference would otherwise bake its
 * credentials into every layer of the result. A repo with no browsable HTTPS
 * form (a local path) gets no OCI source label rather than an empty one.
 */
export function buildProvenanceLabelArgs(provenance: ImageProvenance): string[] {
  const repoUrl = redactRepoCredentials(provenance.repoUrl, provenance.repoToken);
  const { httpsUrl } = normalizeRepoUrls(repoUrl);

  const labels: Array<[string, string | undefined]> = [
    [BUILD_LABELS.repo, repoUrl],
    [BUILD_LABELS.commit, provenance.commit],
    [BUILD_LABELS.dockerfile, provenance.dockerfile],
    [BUILD_LABELS.workflow, provenance.workflow],
    [BUILD_LABELS.namespace, provenance.namespace],
    [OCI_LABELS.source, httpsUrl.length > 0 ? httpsUrl : undefined],
    [OCI_LABELS.revision, provenance.commit],
  ];

  return labels.flatMap(([key, value]) =>
    value === undefined || value.length === 0 ? [] : ['--label', `${key}=${value}`],
  );
}

/**
 * `docker image inspect --format` template pairing an image id with its labels
 * and its layers.
 *
 * `index` rather than `.Config.Labels`: an image with no labels has no such key
 * at all, and the dotted form fails the whole invocation — one unlabelled
 * `postgres` would strip the provenance off every other row in the batch.
 * `docker images` cannot answer this itself; its template context has neither
 * a `.Labels` nor a `.RootFS` field, which is why reading either costs a second
 * call — and why they travel in one call rather than two.
 */
export const IMAGE_INSPECT_FORMAT =
  '{{.Id}}\t{{json (index .Config "Labels")}}\t{{json .RootFS.Layers}}';

/** `docker` arguments that emit one `IMAGE_INSPECT_FORMAT` line per image. */
export function imageInspectArgs(imageIds: readonly string[]): string[] {
  return ['image', 'inspect', '--format', IMAGE_INSPECT_FORMAT, ...imageIds];
}

/** `docker images` truncates ids; `docker image inspect` does not. */
export function shortImageId(id: string): string {
  return id.replace(/^sha256:/, '').slice(0, 12);
}

/** Provenance read back off an image, as the daemon listing exposes it. */
export interface ReadImageProvenance {
  buildRepo?: string;
  buildCommit?: string;
  buildDockerfile?: string;
  buildWorkflow?: string;
  buildNamespace?: string;
}

/**
 * Pick the platform's build labels out of an image's label map.
 *
 * Every field is optional: an image built before the labels existed, or pulled
 * from a registry, simply has none of them and lists unannotated.
 */
export function readProvenanceLabels(
  labels: Readonly<Record<string, string>> | null | undefined,
): ReadImageProvenance {
  const pick = (key: string): string | undefined => {
    const value = labels?.[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  };

  return {
    buildRepo: pick(BUILD_LABELS.repo),
    buildCommit: pick(BUILD_LABELS.commit),
    buildDockerfile: pick(BUILD_LABELS.dockerfile),
    buildWorkflow: pick(BUILD_LABELS.workflow),
    buildNamespace: pick(BUILD_LABELS.namespace),
  };
}

/** What `IMAGE_INSPECT_FORMAT` reads back off one image. */
export interface InspectedImage {
  /** Every label the image carries — the ones inherited from its base
   *  included, indistinguishably. Splitting them is lineage's job. */
  labels: Record<string, string>;
  /** `RootFS.Layers`: ordered, content-addressed diff ids. */
  layers: string[];
}

const LabelMapSchema = z.record(z.string(), z.string()).catch({});
const LayerListSchema = z.array(z.string()).catch([]);

/**
 * Labels and layers for each inspected image, keyed by short id.
 *
 * A line that will not parse annotates nothing and the rest of the batch still
 * stands — a listing degrades to unannotated rows, never to an error.
 */
export function parseImageInspect(stdout: string): Map<string, InspectedImage> {
  const byId = new Map<string, InspectedImage>();

  for (const line of stdout.trim().split('\n')) {
    const [id, rawLabels, rawLayers] = line.split('\t');
    if (!id || !rawLabels) continue;
    try {
      byId.set(shortImageId(id), {
        // `null` for an unlabelled image, and a label map can hold a non-string
        // value; `catch` turns either into the empty answer rather than an
        // exception that would drop the row.
        labels: LabelMapSchema.parse(JSON.parse(rawLabels)),
        layers: LayerListSchema.parse(rawLayers === undefined ? [] : JSON.parse(rawLayers)),
      });
    } catch {
      continue;
    }
  }

  return byId;
}
