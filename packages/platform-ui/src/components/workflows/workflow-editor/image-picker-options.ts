import type { ImageCapabilities, ImageRuntime, WorkflowStep } from '@mediforce/platform-core';
import type { DockerImageInfo, ImageCatalogEntryView } from '@mediforce/platform-api/contract';

/** One `<option>`: the image reference that gets saved, and what a reader sees. */
export interface ImagePickerOption {
  /** `repository:tag` — exactly what lands in the definition. */
  value: string;
  /** Entry name and intent, never a bare `repo:tag` (#1298). */
  label: string;
}

/** One `<optgroup>`. `label === null` is the ungrouped daemon fallback, which
 *  has no catalog to group by. `key` is the grouping identity — two bases may
 *  share a name, and they are still two groups. */
export interface ImagePickerGroup {
  key: string;
  label: string | null;
  options: ImagePickerOption[];
}

/** What the picker has to offer, and whether it has a source at all.
 *
 * `hasSource` is not `groups.length > 0`: a catalog that covers images but none
 * *this* step can run is an answer, and the answer is "none of these". The
 * select still renders — its blank option is what registration falls back to —
 * rather than the caller silently dropping to a free-text field. */
export interface ImagePicker {
  hasSource: boolean;
  groups: ImagePickerGroup[];
}

/** The probed binary a `script.runtime` needs to be present in the image.
 *  `inlineScript` is handed to this interpreter, so an image without it fails
 *  at container start the same way an agent image without a CLI does. */
const RUNTIME_BINARY: Record<NonNullable<WorkflowStep['script']>['runtime'] & string, ImageRuntime> = {
  javascript: 'node',
  python: 'python3',
  r: 'Rscript',
  bash: 'bash',
};

/** The runtime a step is knowably going to need, or `undefined` when it is not
 *  knowable — a `command` step runs whatever the image's own entrypoint has. */
export function requiredRuntimeFor(step: WorkflowStep): ImageRuntime | undefined {
  const runtime = step.script?.runtime;
  return runtime === undefined ? undefined : RUNTIME_BINARY[runtime];
}

/**
 * Whether a probed image may be offered for this executor.
 *
 * `unknown` is always offered: it means nobody could answer, not that the
 * answer was no (ADR-0022 decision 2). What it does not get is a suitability
 * claim — the label says so.
 */
function isOfferable(
  capabilities: ImageCapabilities,
  executor: 'agent' | 'script',
  requiredRuntime: ImageRuntime | undefined,
): boolean {
  if (capabilities.status !== 'known') return true;
  if (executor === 'agent') return capabilities.agentCapable;
  if (requiredRuntime === undefined) return true;
  return capabilities.runtimes.includes(requiredRuntime);
}

function versionLabel(entry: ImageCatalogEntryView, imageTag: string, unvouched: boolean): string {
  // The tag only earns its place when the entry has more than one — otherwise
  // it repeats what the name already said.
  const tag = entry.versions.length > 1 ? ` (${imageTag.split(':').at(-1) ?? imageTag})` : '';
  const caveat = unvouched ? ' · not probed' : '';
  // A discovered entry is an image this namespace built that nobody has
  // described. It is still offered — it is the image the author's own workflow
  // produced — but the slot the sentence would fill says why it is empty
  // rather than trailing a dash into nothing.
  const intent = entry.intent.length > 0 ? entry.intent : 'not described yet';
  return `${entry.name}${tag} — ${intent}${caveat}`;
}

function groupLabel(baseEntryId: string | null, nameById: ReadonlyMap<string, string>): string {
  if (baseEntryId === null) return 'Base images';
  return `Built on ${nameById.get(baseEntryId) ?? 'an image outside this catalog'}`;
}

function imageRef(image: DockerImageInfo): string {
  return image.tag && image.tag !== '<none>' ? `${image.repository}:${image.tag}` : image.repository;
}

/**
 * The picker's options, sourced from the namespace's image catalog.
 *
 * Curation, not an allowlist (ADR-0022 decision 5): the free-text field beside
 * the select still saves any string, and a step already pinning an image no
 * entry covers keeps that value. What the catalog decides is only what is
 * *offered* — which is why a bare `alpine` stops being one click away from an
 * agent step whose container would die on `exec: "claude"`.
 *
 * Entries arrive in the handler's roots-first order and keep it; grouping only
 * gathers each entry under the one it was built on, so derivatives of the
 * golden image sit together.
 *
 * An entry with no versions is not offered: the daemon holds no image for it,
 * so there is nothing to pin. That also covers an unreachable daemon, where
 * every entry is version-less and the caller falls back to the daemon list.
 */
export function buildCatalogImageGroups(
  entries: readonly ImageCatalogEntryView[],
  executor: 'agent' | 'script',
  requiredRuntime?: ImageRuntime,
): ImagePickerGroup[] {
  const nameById = new Map(entries.map((entry) => [entry.id, entry.name]));
  const groups = new Map<string, ImagePickerGroup>();

  for (const entry of entries) {
    const options = entry.versions
      .filter((version) => isOfferable(version.capabilities, executor, requiredRuntime))
      .map((version) => ({
        value: version.imageTag,
        label: versionLabel(entry, version.imageTag, version.capabilities.status !== 'known'),
      }));
    if (options.length === 0) continue;

    const key = entry.baseEntryId ?? '';
    const group = groups.get(key)
      ?? { key, label: groupLabel(entry.baseEntryId, nameById), options: [] };
    group.options.push(...options);
    groups.set(key, group);
  }

  return [...groups.values()];
}

/**
 * Every image the daemon holds, ungrouped — what the picker offered before the
 * catalog existed, and what it falls back to when the catalog has nothing to
 * say (empty, unreachable, or a daemon nobody could ask).
 *
 * No suitability marks here on purpose. Without a catalog nothing has been
 * probed, and the blank option already names the image registration fills in,
 * so ranking one row by its name would be a claim the picker cannot support.
 */
export function buildDaemonImageGroups(images: readonly DockerImageInfo[]): ImagePickerGroup[] {
  if (images.length === 0) return [];
  return [{
    key: 'daemon',
    label: null,
    options: images.map((image) => ({ value: imageRef(image), label: imageRef(image) })),
  }];
}

/**
 * The catalog's answer when it has one, the daemon listing when it does not.
 *
 * The fallback turns on whether the catalog *covers any image at all*, never on
 * whether it offered one for this step. A catalog holding only script images
 * has answered an agent step — with "none of these" — and re-offering the raw
 * daemon list there would put back the `alpine` this whole change removes.
 */
export function buildImagePicker(input: {
  catalogEntries: readonly ImageCatalogEntryView[];
  dockerImages: readonly DockerImageInfo[];
  executor: 'agent' | 'script';
  requiredRuntime?: ImageRuntime;
}): ImagePicker {
  const catalogCoversAnImage = input.catalogEntries.some((entry) => entry.versions.length > 0);
  if (catalogCoversAnImage) {
    return {
      hasSource: true,
      groups: buildCatalogImageGroups(input.catalogEntries, input.executor, input.requiredRuntime),
    };
  }
  const groups = buildDaemonImageGroups(input.dockerImages);
  return { hasSource: groups.length > 0, groups };
}
