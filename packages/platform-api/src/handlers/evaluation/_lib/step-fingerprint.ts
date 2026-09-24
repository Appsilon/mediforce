import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import {
  resolveBuildSource,
  resolveCarriedBuild,
  resolveMcpForStep,
  resolveStepImage,
} from '@mediforce/agent-runtime';
import {
  STEP_FINGERPRINT_COMPONENTS,
  type StepFingerprint,
  type StepFingerprintComponent,
  type WorkflowDefinition,
  type WorkflowStep,
} from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';

/** JSON with object keys sorted at every depth, so equal values hash equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * The step config that shapes what the agent does. Left out: its name and
 * display, who reviews or may act on it, and how its output is routed —
 * `autonomyLevel`, `review`, `confidenceThreshold`, `fallbackBehavior` — so
 * acting on the routing a qualification recommends does not make it stale.
 * The model is a component of its own, resolved the way the runtime does.
 */
function behaviouralStep(step: WorkflowStep): unknown {
  const { confidenceThreshold: _threshold, fallbackBehavior: _fallback, model: _model, ...agent } = step.agent ?? {};
  return {
    executor: step.executor,
    plugin: step.plugin,
    agentId: step.agentId,
    agent,
    params: step.params,
    stepParams: step.stepParams,
    env: step.env,
    mcpRestrictions: step.mcpRestrictions,
  };
}

/**
 * The skill the runtime loads: every file the workflow carries under
 * `<skillsDir>/<skill>/`, or, fetched from the external skills repository, the
 * commit and path it is read from.
 */
function skillIdentity(definition: WorkflowDefinition, step: WorkflowStep): unknown {
  const skill = step.agent?.skill;
  const skillsDir = step.agent?.skillsDir;
  if (skill === undefined || skill === '' || skillsDir === undefined || skillsDir === '') return null;
  const directory = `${posix.normalize(posix.join(skillsDir, skill))}/`;
  const carried = (definition.artifacts ?? [])
    .filter((artifact) => posix.normalize(artifact.path).startsWith(directory))
    .map((artifact) => ({ path: posix.normalize(artifact.path), sha256: sha256(artifact.contents) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (carried.length > 0) return { carried };
  const repo = definition.externalSkillsRepo;
  return repo === undefined ? { missing: directory } : { repo: repo.url, commit: repo.commit, path: directory };
}

/**
 * The image the step runs in, as the runtime resolves it: the tag it names or
 * derives, the files a carried Dockerfile builds from, and the commit a
 * repository build checks out. A tag the author re-pushes under the same name
 * does not change it — pin an image by digest (`image@sha256:…`) for that.
 */
function imageIdentity(definition: WorkflowDefinition, step: WorkflowStep): unknown {
  const config = step.agent;
  if (config === undefined) return null;
  return {
    image: resolveStepImage(config, definition) ?? null,
    carriedBuild: resolveCarriedBuild(config, definition)?.meta.artifactsHash ?? null,
    buildSource: resolveBuildSource(config, definition.externalSkillsRepo) ?? null,
  };
}

/**
 * The Step Fingerprint (ADR-0023 D5): a SHA-256 over the parts of an agent
 * Step that shape its behaviour — the step config, the model it runs, its
 * agent's system prompt, the skill it loads, its image, the MCP servers and
 * tools production resolves for it, and the workflow preamble. Each part is
 * hashed on its own, so two Fingerprints can say what differs. The MCP eval
 * policy is not part of it (D6); a Step Qualification states it instead.
 */
export async function computeStepFingerprint(
  scope: CallerScope,
  definition: WorkflowDefinition,
  step: WorkflowStep,
): Promise<StepFingerprint> {
  const agent = step.agentId === undefined ? null : await scope.agentDefinitions.getById(step.agentId);
  const mcpServers = await resolveMcpForStep(step, {
    agentDefinitionRepo: scope.agentDefinitions,
    toolCatalogRepo: scope.toolCatalog,
    namespace: definition.namespace,
  }).then(
    (config) => ({ servers: config?.servers ?? null }),
    () => ({ refused: true }),
  );
  const material: Record<StepFingerprintComponent, unknown> = {
    step: behaviouralStep(step),
    model: step.agent?.model ?? agent?.foundationModel ?? null,
    systemPrompt: agent?.systemPrompt ?? null,
    skill: skillIdentity(definition, step),
    image: imageIdentity(definition, step),
    mcpServers,
    preamble: definition.preamble ?? null,
  };
  const components = Object.fromEntries(
    STEP_FINGERPRINT_COMPONENTS.map((component) => [component, sha256(canonicalJson(material[component]))]),
  ) as Record<StepFingerprintComponent, string>;
  return { hash: sha256(canonicalJson(components)), components };
}

/** The parts of a Step Fingerprint that differ between two. */
export function changedFingerprintComponents(before: StepFingerprint, after: StepFingerprint): StepFingerprintComponent[] {
  return STEP_FINGERPRINT_COMPONENTS.filter((component) => before.components[component] !== after.components[component]);
}
