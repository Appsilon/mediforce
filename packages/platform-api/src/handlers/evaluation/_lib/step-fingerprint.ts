import { createHash } from 'node:crypto';
import {
  AgentDefinitionNotFoundError,
  RetiredFileSkillError,
  SkillNotFoundError,
  resolveBuildSource,
  resolveCarriedBuild,
  resolveMcpForStep,
  resolveSkillsForStep,
  resolveStepImage,
  type ResolveMcpForStepDeps,
  type ResolveSkillsForStepDeps,
} from '@mediforce/agent-runtime';
import {
  STEP_FINGERPRINT_COMPONENTS,
  canonicalJson,
  offeredSkill,
  type StepFingerprint,
  type StepFingerprintComponent,
  type WorkflowDefinition,
  type WorkflowStep,
} from '@mediforce/platform-core';

/** The repositories a Fingerprint reads the step's agent, tools and skills from — a CallerScope, or the runtime's own. */
export interface StepFingerprintRepos {
  agentDefinitions: ResolveMcpForStepDeps['agentDefinitionRepo'];
  toolCatalog: ResolveMcpForStepDeps['toolCatalogRepo'];
  /** A caller's scope reads the same Skills the runtime does for any agent the
   *  caller can see: a private agent is visible only to its workspace's
   *  members, who see its private Skills, and a public one holds only public
   *  Skills. */
  skills: ResolveSkillsForStepDeps['skillRepo'];
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * The step config that shapes what the agent does. Left out: its name and
 * display, who reviews or may act on it, and how its output is routed —
 * `autonomyLevel`, `review` — so acting on the routing a qualification
 * recommends does not make it stale.
 * The model is a component of its own, resolved the way the runtime does.
 */
function behaviouralStep(step: WorkflowStep): unknown {
  const { model: _model, ...agent } = step.agent ?? {};
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
 * The `skill` component: the Skills offered to the step — its agent's and the
 * ones it adds — by reference and content hash (ADR-0025 decision 7), so
 * editing one makes the step a changed step. A step offered none hashes to
 * `null`, as it always has. `step` held the workflow-file skill until ADR-0028
 * retired it; it stays `null` so the Fingerprints of steps that never had one
 * do not move. A reference that no longer resolves, or a retired file skill
 * the step still names, is a component of its own, as the runtime refuses to
 * run the step.
 */
async function skillComponent(repos: StepFingerprintRepos, definition: WorkflowDefinition, step: WorkflowStep): Promise<unknown> {
  const offered = await resolveSkillsForStep(step, {
    agentDefinitionRepo: repos.agentDefinitions,
    skillRepo: repos.skills,
  }, definition).then(
    (skills) => skills ?? [],
    (error: unknown) => {
      if (error instanceof SkillNotFoundError || error instanceof RetiredFileSkillError) return null;
      if (error instanceof AgentDefinitionNotFoundError) return [];
      throw error;
    },
  );
  if (offered === null) return { step: null, agentSkills: { refused: true } };
  if (offered.length === 0) return null;
  return {
    step: null,
    agentSkills: offered
      .map(offeredSkill)
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
  };
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
    buildSource: resolveBuildSource(config) ?? null,
  };
}

/**
 * The Step Fingerprint (ADR-0023 D5): a SHA-256 over the parts of an agent
 * Step that shape its behaviour — the step config, the model it runs, its
 * agent's system prompt, the skills it loads, its image, the MCP servers and
 * tools production resolves for it, and the workflow preamble. Each part is
 * hashed on its own, so two Fingerprints can say what differs. The MCP eval
 * policy is not part of it (D6); a Step Qualification states it instead.
 */
export async function computeStepFingerprint(
  repos: StepFingerprintRepos,
  definition: WorkflowDefinition,
  step: WorkflowStep,
): Promise<StepFingerprint> {
  const agent = step.agentId === undefined ? null : await repos.agentDefinitions.getById(step.agentId);
  const mcpServers = await resolveMcpForStep(step, {
    agentDefinitionRepo: repos.agentDefinitions,
    toolCatalogRepo: repos.toolCatalog,
    namespace: definition.namespace,
  }).then(
    (config) => ({ servers: config?.servers ?? null }),
    () => ({ refused: true }),
  );
  const material: Record<StepFingerprintComponent, unknown> = {
    step: behaviouralStep(step),
    model: step.agent?.model ?? agent?.foundationModel ?? null,
    systemPrompt: agent?.systemPrompt ?? null,
    skill: await skillComponent(repos, definition, step),
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
