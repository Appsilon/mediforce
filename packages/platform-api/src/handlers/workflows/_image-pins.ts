import { resolveStepImage } from '@mediforce/agent-runtime';
import type { CallerIdentity } from '../../auth';
import { ConflictError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import {
  normalizeImageRef,
  pickRunnableVersion,
  type AgentDefinition,
  type WorkflowDefinition,
  type WorkflowDefinitionGroup,
} from '@mediforce/platform-core';

/** One workflow **version** that pins one or more of the images asked about. */
export interface WorkflowImagePin {
  namespace: string;
  name: string;
  title: string | undefined;
  version: number;
  /** Needed by both callers to decide what a foreign reader may be told. */
  visibility: WorkflowDefinition['visibility'];
  /**
   * The version a run starts from — `pickRunnableVersion`, the rule every
   * firing resolves through: the default version if it is live, otherwise the
   * newest live one.
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
  /**
   * The version runs would start from once this one is archived, or `null`
   * when none would be left — archiving it then archives the whole workflow,
   * which moves behind the catalog's "Archived workflows" until restored.
   * Meaningful for a live pin; for any other it is simply the live version.
   */
  fallbackVersion: number | null;
  /** Step ids in this version that pin one of the images. */
  steps: string[];
  /** Which of the requested images this version uses, in the order asked —
   *  echoed back as the caller spelled them. */
  images: string[];
}

/** Every image one version's steps resolve to, agent and script alike, by the
 *  rule the runtime resolves them with. A build-mode step carries no `image`,
 *  so its tag is derived — otherwise the scan is blind to exactly the
 *  `mediforce-built:*` and `mediforce-artifacts:*` rows that need naming. */
function stepImages(definition: WorkflowDefinition): { stepId: string; image: string }[] {
  const resolved: { stepId: string; image: string }[] = [];
  for (const step of definition.steps) {
    const image =
      resolveStepImage(step.agent, definition) ?? resolveStepImage(step.script, definition);
    if (typeof image !== 'string') continue;
    resolved.push({ stepId: step.id, image });
  }
  return resolved;
}

/**
 * Which workflow versions pin a given set of image tags.
 *
 * One place, because the callers ask the same question for opposite reasons:
 * `GET /api/workflow-definitions/by-image` renders "used by", and
 * `assertNoLiveImagePins` below refuses to destroy an image a live version
 * needs. They must not be allowed to disagree about what counts as a pin.
 *
 * **Every version, not just the latest.** The read this replaced looked at
 * `latestVersion` alone and skipped archived workflows entirely, so "what
 * breaks if I delete this?" was answered from a fraction of the definitions
 * that could break.
 */

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
    const liveVersion = pickRunnableVersion(group.versions, group.defaultVersion)?.version;
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
        live: definition.version === liveVersion,
        isDefault: group.defaultVersion === definition.version,
        archived,
        fallbackVersion:
          pickRunnableVersion(
            group.versions.filter((other) => other.version !== definition.version),
            group.defaultVersion,
          )?.version ?? null,
        steps: matchingSteps,
        images: images.filter((image) => matched.has(image)),
      });
    }
  }

  return pins;
}

/**
 * Agents (ADR-0029 decision 9) whose own `image` names one of the images
 * asked about. An agent naming no image runs the golden image and is never a
 * pin — only an explicit `image` can be orphaned by a delete.
 */
export function findAgentImagePins(
  agents: readonly AgentDefinition[],
  images: readonly string[],
): AgentDefinition[] {
  const needles = new Set(images.map(normalizeImageRef));
  return agents.filter(
    (agent) => agent.image !== undefined && needles.has(normalizeImageRef(agent.image)),
  );
}

/**
 * Refuse to destroy images a live workflow version, or an agent, still runs on.
 *
 * Shared by both doors onto that act — Admin → Infrastructure's
 * `deleteDockerImage` and the Image Catalog's composite delete — so the rule
 * and the message it refuses with cannot drift between them (#1375).
 *
 * Judged deployment-wide, because the daemon is: a step or agent in a
 * namespace this caller cannot read breaks just the same. Superseded and
 * archived workflow versions do not block, for the reason `WorkflowImagePin.live`
 * states — an agent carries no such history, so every pin on it blocks.
 */
export async function assertNoLiveImagePins(
  tags: readonly string[],
  scope: CallerScope,
): Promise<void> {
  const live = findWorkflowImagePins(
    await scope.workflowDefinitions.listGroupsForImageAudit(),
    tags,
  ).filter((pin) => pin.live);
  const agentPins = findAgentImagePins(
    await scope.agentDefinitions.listAllForImageAudit(),
    tags,
  );
  if (live.length > 0 || agentPins.length > 0) {
    throw new ConflictError(describeLivePins(live, agentPins, scope.caller));
  }
}

/**
 * Why a delete was refused, in terms the caller can act on.
 *
 * Redacted, because the scan behind it is deployment-wide while workflow and
 * agent names are not: a private workflow or agent in a namespace this caller
 * has not joined is counted, never named. The count still has to be there — a
 * block with no reason is indistinguishable from a bug.
 */
function describeLivePins(
  live: readonly WorkflowImagePin[],
  agentPins: readonly AgentDefinition[],
  caller: CallerIdentity,
): string {
  const visibleWorkflows = live.filter(
    (pin) =>
      caller.isSystemActor || caller.namespaces.has(pin.namespace) || pin.visibility === 'public',
  );
  const visibleAgents = agentPins.filter(
    (agent) =>
      caller.isSystemActor ||
      agent.visibility === 'public' ||
      (typeof agent.namespace === 'string' && caller.namespaces.has(agent.namespace)),
  );
  const hidden = live.length - visibleWorkflows.length + (agentPins.length - visibleAgents.length);

  const named = [
    ...visibleWorkflows.map(
      (pin) => `${pin.namespace}/${pin.name} v${String(pin.version)} (${pin.steps.join(', ')})`,
    ),
    ...visibleAgents.map((agent) => `agent '${agent.name}' (${agent.namespace ?? 'built-in'})`),
  ];
  if (hidden > 0) {
    named.push(
      `${String(hidden)} more in ${hidden === 1 ? 'a workspace' : 'workspaces'} you cannot see`,
    );
  }

  const subject = [
    live.length > 0 ? `${String(live.length)} workflow version${live.length === 1 ? '' : 's'}` : null,
    agentPins.length > 0 ? `${String(agentPins.length)} agent${agentPins.length === 1 ? '' : 's'}` : null,
  ]
    .filter((part) => part !== null)
    .join(' and ');
  const total = live.length + agentPins.length;
  return (
    `Cannot delete these images: ${subject} still use${total === 1 ? 's' : ''} ${total === 1 ? 'it' : 'them'} — ${named.join('; ')}. ` +
    'Point those steps or agents at another image, or archive the workflow version, then delete again. ' +
    'Superseded and archived workflow versions do not block, since a registered version cannot be re-pointed.'
  );
}
