import { z } from 'zod';
import { redactRepoCredentials } from '../utils/repo-url';
import type { InspectedImage } from '../utils/image-provenance';

/**
 * Lineage: which image an image was built on, computed rather than parsed.
 *
 * `docker image inspect` returns `RootFS.Layers` as an ordered array of
 * content-addressed diff ids, and a child image's array is its parent's array
 * with new entries appended. So image X descends from image P **iff**
 * `X.layers` starts with the whole of `P.layers` — an exact test, with no
 * `FROM` string to match and no Dockerfile to hold, which is what lets it work
 * for images the platform did not build (ADR-0021 decision 2).
 */

/** An image reduced to what lineage needs: its id and its ordered diff ids. */
export interface LayeredImage {
  id: string;
  layers: readonly string[];
}

/**
 * Whether `childLayers` descends from `parentLayers`.
 *
 * Two exclusions, both deliberate. A layerless parent is a prefix of every
 * array, so it would become the ancestor of the whole daemon; and equal-length
 * arrays cannot be ordered from layers alone — a metadata-only child (`LABEL`,
 * `ENV`, `CMD`) shares its parent's rootfs exactly, so calling either one the
 * ancestor would be a guess. This function never guesses.
 */
export function isImageDescendantOf(
  childLayers: readonly string[],
  parentLayers: readonly string[],
): boolean {
  if (parentLayers.length === 0 || parentLayers.length >= childLayers.length) return false;
  return parentLayers.every((layer, index) => childLayers[index] === layer);
}

/**
 * The nearest ancestor of each image among the images given, keyed by image id.
 *
 * "Nearest" is the candidate with the most layers: every ancestor of X is a
 * prefix of X and therefore a prefix of every other ancestor, so they form a
 * chain and the longest is the immediate parent. An image with no ancestor
 * present is absent from the map — it is a root *on this daemon*, which is not
 * the same as having been built from nothing.
 *
 * Ties — two distinct images with identical layer arrays — resolve to the one
 * listed first, so a listing produces the same lineage twice running.
 */
export function resolveImageBases(images: readonly LayeredImage[]): Map<string, string> {
  const unique = [...new Map(images.map((image) => [image.id, image])).values()];
  const bases = new Map<string, string>();

  for (const image of unique) {
    let nearest: LayeredImage | undefined;
    for (const candidate of unique) {
      if (candidate.id === image.id) continue;
      if (!isImageDescendantOf(image.layers, candidate.layers)) continue;
      if (nearest === undefined || candidate.layers.length > nearest.layers.length) {
        nearest = candidate;
      }
    }
    if (nearest !== undefined) bases.set(image.id, nearest.id);
  }

  return bases;
}

/**
 * The labels this image sets itself, dropping the ones it inherited.
 *
 * Docker copies a base image's labels onto every child, indistinguishably from
 * the child's own, which is how a local image of ours comes to report
 * `org.opencontainers.image.source = https://github.com/rocker-org/rocker-versioned2`.
 * A label identical in the base is the base's claim, not this image's; a key
 * the image overrode with a different value is its own.
 *
 * The base here is the *immediate* ancestor rather than the entry's catalog
 * base: inheritance is a Docker fact about the layer below, so anything else
 * would credit an image with labels it never set. An image whose parent is not
 * on the daemon has no base to diff against and owns everything it carries.
 */
export function ownImageLabels(
  labels: Readonly<Record<string, string>>,
  baseLabels: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  if (baseLabels === undefined) return { ...labels };
  return Object.fromEntries(
    Object.entries(labels).filter(([key, value]) => baseLabels[key] !== value),
  );
}

/** What a daemon listing carries about one image's ancestry, per image id. */
export interface ImageLineageFacts {
  /** The image's nearest ancestor on this daemon; absent for a root. */
  baseImageId?: string;
  /** The labels this image sets itself — see `ownImageLabels`. */
  ownLabels: Record<string, string>;
}

/**
 * Ancestry and label ownership for a whole daemon listing, keyed by image id.
 *
 * Computed where the layers already are — one pass over the inspect batch the
 * listing runs anyway — so lineage costs no extra daemon call and the layer
 * arrays themselves never have to travel to a client that only wants the
 * answer. Every image on the daemon is a candidate base, so an image built on
 * `python3.12-slim` groups under it exactly as one built on the golden image
 * groups under that: nothing here knows any image by name.
 */
export function resolveImageLineage(
  inspected: ReadonlyMap<string, InspectedImage>,
): Map<string, ImageLineageFacts> {
  const images = [...inspected].map(([id, image]) => ({ id, layers: image.layers }));
  const bases = resolveImageBases(images);

  return new Map(
    [...inspected].map(([id, image]) => {
      const baseImageId = bases.get(id);
      const baseLabels =
        baseImageId === undefined ? undefined : inspected.get(baseImageId)?.labels;
      return [
        id,
        {
          ...(baseImageId === undefined ? {} : { baseImageId }),
          ownLabels: ownImageLabels(image.labels, baseLabels),
        },
      ];
    }),
  );
}

/**
 * One step of an image's layer summary.
 *
 * **This is never "the Dockerfile".** `docker history` has no file contents, no
 * comments, no formatting, no multi-stage structure and `<missing>` for every
 * intermediate id. It is what the image records about how it was assembled,
 * and every consumer must label it that way (#1297).
 */
export const ImageBuildStepSchema = z
  .object({
    /** The build instruction, tidied and redacted for reading. */
    command: z.string(),
    /** The daemon's own human size string for the step, e.g. "1GB". */
    size: z.string(),
  })
  .strict();

export type ImageBuildStep = z.infer<typeof ImageBuildStepSchema>;

/** Wall-clock ceiling for one `docker history` call. Metadata only — no
 *  container starts — so it is bounded against a wedged daemon, nothing else. */
export const IMAGE_HISTORY_TIMEOUT_MS = 10_000;

/** `docker` arguments emitting one JSON history row per line, newest first.
 *  `--no-trunc` because a truncated `RUN` is unreadable and, worse, silently
 *  hides the tail of a command a reader is being asked to trust. */
export function imageHistoryArgs(image: string): string[] {
  return ['history', '--no-trunc', '--format', '{{json .}}', image];
}

/** Keys whose value is a secret wherever it appears — a `--build-arg` that
 *  carried one, an `ENV` that baked one in. Matched loosely on purpose: over-
 *  redacting a build step costs a reader nothing, under-redacting it once is
 *  a credential in a UI. */
const SENSITIVE_KEY =
  /(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|AUTH)/i;

const ASSIGNMENT = /\b([A-Za-z_][A-Za-z0-9_]*)=(\S+)/g;

/** `RUN |2 A=x B=y /bin/sh -c …` — the build args docker inlines verbatim. */
const BUILD_ARG_PREFIX = /^RUN\s+\|(\d+)\s+/;
const SHELL_PREFIX = /^\/bin\/sh -c\s+/;
const NOP_PREFIX = /^\/bin\/sh -c\s+#\(nop\)\s+/;
const BUILDKIT_MARKER = /\s*#\s*buildkit\s*$/;

function redactSensitiveAssignments(command: string): string {
  const withoutCredentials = redactRepoCredentials(command);
  return withoutCredentials.replace(ASSIGNMENT, (match, key: string) =>
    SENSITIVE_KEY.test(key) ? `${key}=***` : match,
  );
}

/**
 * Redact the `count` build-arg values docker inlined ahead of the command.
 *
 * Every one of them is redacted, not just the ones whose name looks like a
 * secret: these are the values the caller passed at build time, and the point
 * of `--build-arg` is that the platform does not know what is in them.
 */
function redactBuildArgs(rest: string, count: number): { args: string[]; command: string } {
  let remaining = rest;
  const args: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const argument = remaining.match(/^(\S+?)=(\S*)\s*/);
    if (argument === null) break;
    args.push(`${argument[1]}=***`);
    remaining = remaining.slice(argument[0].length);
  }

  return { args, command: remaining };
}

/**
 * One `docker history` command, tidied into something a person can read and
 * stripped of anything the daemon renders verbatim that we cannot vouch for.
 *
 * The tidying is cosmetic — dropping `# buildkit`, `#(nop)` and the `/bin/sh -c`
 * wrapper docker wraps every `RUN` in — and the redaction is not: build args
 * reach this string with their values in them.
 */
export function readableBuildStepCommand(createdBy: string): string {
  const stripped = createdBy.replace(BUILDKIT_MARKER, '').trim();

  if (NOP_PREFIX.test(stripped)) {
    return redactSensitiveAssignments(stripped.replace(NOP_PREFIX, '').trim());
  }

  const buildArgs = stripped.match(BUILD_ARG_PREFIX);
  if (buildArgs !== null) {
    const { args, command } = redactBuildArgs(
      stripped.slice(buildArgs[0].length),
      Number(buildArgs[1]),
    );
    const body = [...args, command.replace(SHELL_PREFIX, '').trim()].join(' ');
    return redactSensitiveAssignments(`RUN ${body}`);
  }

  if (stripped.startsWith('RUN ')) {
    return redactSensitiveAssignments(`RUN ${stripped.slice(4).replace(SHELL_PREFIX, '').trim()}`);
  }

  if (SHELL_PREFIX.test(stripped)) {
    return redactSensitiveAssignments(`RUN ${stripped.replace(SHELL_PREFIX, '').trim()}`);
  }

  return redactSensitiveAssignments(stripped);
}

/**
 * An image's build steps, oldest first.
 *
 * `docker history` prints newest first; reversing it puts the steps in the
 * order they ran, which is both how a reader expects to see them and what
 * makes the base's steps a *prefix* of its child's (see `imageStepDelta`).
 * A row that will not parse is dropped rather than failing the summary.
 */
export function parseImageHistory(stdout: string): ImageBuildStep[] {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return [];

  const steps: ImageBuildStep[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    try {
      const row: unknown = JSON.parse(line);
      const parsed = z
        .object({ CreatedBy: z.string(), Size: z.string().default('') })
        .safeParse(row);
      if (!parsed.success) continue;
      steps.push({
        command: readableBuildStepCommand(parsed.data.CreatedBy),
        size: parsed.data.Size,
      });
    } catch {
      continue;
    }
  }

  return steps.reverse();
}

/**
 * The steps an image adds over its base — the whole point of resolving a base.
 *
 * `docker history` emits **no `FROM` boundary**: the base's steps and the
 * child's come back as one flat list with nothing separating them, so a real
 * image renders rocker's `COPY scripts /rocker_scripts`, the golden image's
 * `npm install -g @anthropic-ai/claude-code` and the workflow image's
 * `COPY mcp /app/mcp` as equals. Cutting the list at the base's length is what
 * turns it into "what this image adds".
 *
 * The cut is by count, not by comparing commands: the base's steps are the
 * child's first steps by construction — the child was built on that exact
 * image. A list that is not longer than the base's adds nothing, which is the
 * honest answer for a base that is the image itself.
 */
export function imageStepDelta(
  steps: readonly ImageBuildStep[],
  baseSteps: readonly ImageBuildStep[],
): ImageBuildStep[] {
  if (steps.length <= baseSteps.length) return [];
  return steps.slice(baseSteps.length);
}
