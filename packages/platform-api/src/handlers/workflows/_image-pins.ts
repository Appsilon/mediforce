import { resolveStepImage } from '@mediforce/agent-runtime';
import type { WorkflowDefinition, WorkflowDefinitionGroup } from '@mediforce/platform-core';

/**
 * Which workflow versions pin a given set of image tags.
 *
 * One place, because two callers ask the same question for opposite reasons:
 * `GET /api/workflow-definitions/by-image` renders "used by", and
 * `deleteImageCatalogEntry` refuses to destroy an image a live version needs.
 * They must not be allowed to disagree about what counts as a pin.
 *
 * **Every version, not just the latest.** The read this replaced looked at
 * `latestVersion` alone and skipped archived workflows entirely, so "what
 * breaks if I delete this?" was answered from a fraction of the definitions
 * that could break.
 */

/** One workflow **version** that pins one or more of the images asked about. */
export interface WorkflowImagePin {
  namespace: string;
  name: string;
  title: string | undefined;
  version: number;
  /** Needed by both callers to decide what a foreign reader may be told. */
  visibility: WorkflowDefinition['visibility'];
  /**
   * A version a run can still start from: the workflow's default version if it
   * sets one, otherwise its latest — and not archived.
   *
   * The distinction is what makes a delete decidable. A live pin is a run that
   * will fail at container start, and the author can still re-point it. A
   * superseded pin is history: a registered version is immutable, so no edit
   * can move it off the image, and refusing to delete on its account would
   * mean no image ever pinned by any version could be reclaimed.
   */
  live: boolean;
  /**
   * Whether the workflow explicitly pins this as its default version.
   *
   * Separate from `live` because the remedies differ: a latest-by-default
   * version can simply be archived, while archiving an explicitly chosen
   * default would leave the workflow pointing at a version that cannot run.
   */
  isDefault: boolean;
  archived: boolean;
  /** Step ids in this version that pin one of the images. */
  steps: string[];
  /** Which of the requested images this version uses, in the order asked —
   *  echoed back as the caller spelled them. */
  images: string[];
}

/** `repo` and `repo:latest` are the same image to Docker, so they must be the
 *  same needle here. */
export function normalizeImageRef(ref: string): string {
  return ref.includes(':') ? ref : `${ref}:latest`;
}

/** Every image one version's steps resolve to, agent and script alike. A
 *  build-mode step carries no `image`, so its tag is derived the way the
 *  runtime derives it — otherwise the scan is blind to exactly the
 *  `mediforce-built:*` rows that need naming. */
function stepImages(definition: WorkflowDefinition): { stepId: string; image: string }[] {
  const workflowRepo = definition.externalSkillsRepo;
  const resolved: { stepId: string; image: string }[] = [];
  for (const step of definition.steps) {
    const image =
      resolveStepImage(step.agent, workflowRepo) ?? resolveStepImage(step.script, workflowRepo);
    if (typeof image !== 'string') continue;
    resolved.push({ stepId: step.id, image });
  }
  return resolved;
}

export function findWorkflowImagePins(
  groups: readonly WorkflowDefinitionGroup[],
  images: readonly string[],
): WorkflowImagePin[] {
  if (images.length === 0) return [];
  // Normalized needle -> the caller's own spelling, so `images` echoes back
  // what was asked for rather than what matching canonicalised it to.
  const needles = new Map(images.map((image) => [normalizeImageRef(image), image]));
  const pins: WorkflowImagePin[] = [];

  for (const group of groups) {
    // The version a run starts from. `defaultVersion` wins over `latestVersion`
    // because the newest may be a draft nobody runs.
    const liveVersion = group.defaultVersion ?? group.latestVersion;
    for (const definition of group.versions) {
      const matchingSteps: string[] = [];
      const matched = new Set<string>();
      for (const { stepId, image } of stepImages(definition)) {
        const needle = needles.get(normalizeImageRef(image));
        if (needle === undefined) continue;
        matchingSteps.push(stepId);
        matched.add(needle);
      }
      if (matchingSteps.length === 0) continue;

      const archived = definition.archived === true;
      pins.push({
        namespace: definition.namespace,
        name: definition.name,
        title: definition.title,
        version: definition.version,
        visibility: definition.visibility,
        live: archived === false && definition.version === liveVersion,
        isDefault: group.defaultVersion === definition.version,
        archived,
        steps: matchingSteps,
        images: images.filter((image) => matched.has(image)),
      });
    }
  }

  return pins;
}
