import {
  mayHoldSkill,
  type AgentDefinition,
  type AgentDefinitionRepository,
  type AgentSkillRef,
  type Skill,
  type WorkflowDefinition,
  type WorkflowStep,
} from '@mediforce/platform-core';
import { AgentDefinitionNotFoundError } from '../mcp/resolve-mcp-for-step';

/** Who names a Skill reference: the step's agent, or the step itself. */
export type SkillOfferer = { kind: 'agent' | 'step'; id: string };

/** Raised when an agent or step names a Skill that no longer exists, or that
 *  it may no longer reach. A broken reference must surface, not quietly mean
 *  "no skills". */
export class SkillNotFoundError extends Error {
  public readonly namespace: string;
  public readonly skillId: string;
  public readonly offerer: SkillOfferer;

  constructor(ref: AgentSkillRef, offerer: SkillOfferer) {
    super(
      `Skill '${ref.namespace}/${ref.id}' (offered by ${offerer.kind} '${offerer.id}') not found, ` +
      `or not reachable by the ${offerer.kind}; remove it from the ${offerer.kind} or restore the skill`,
    );
    this.name = 'SkillNotFoundError';
    this.namespace = ref.namespace;
    this.skillId = ref.id;
    this.offerer = offerer;
  }
}

export interface ResolveSkillsForStepDeps {
  agentDefinitionRepo: Pick<AgentDefinitionRepository, 'getById'>;
  skillRepo: { getById(namespace: string, id: string): Promise<Skill | null> };
}

/** Resolve the Skills offered to a workflow step: its agent's, then the ones
 *  the step adds (ADR-0025 §4, ADR-0027).
 *
 *  Contract, the same as resolveMcpForStep:
 *   - no agentId and no step Skills → null.
 *   - AgentDefinition missing → AgentDefinitionNotFoundError.
 *   - a reference to a Skill that is gone, or that its offerer may no longer
 *     reach → SkillNotFoundError. The agent's rule is its own
 *     namespace and visibility; the step's is its workflow's.
 *   - otherwise the agent's Skills in its order, then the step's; a step
 *     Skill replaces the agent's Skill of the same id.
 *
 *  Each Skill resolves in the namespace its reference names, never the
 *  workflow's. */
export async function resolveSkillsForStep(
  step: WorkflowStep,
  deps: ResolveSkillsForStepDeps,
  workflow: Pick<WorkflowDefinition, 'namespace' | 'visibility'>,
): Promise<Skill[] | null> {
  const stepRefs = step.agent?.skills ?? [];
  if (step.agentId === undefined && stepRefs.length === 0) return null;

  const agentSkills = step.agentId === undefined ? [] : await resolveAgentSkills(step.agentId, step.id, deps);
  const stepSkills = await resolveOfferedSkills(stepRefs, workflow, { kind: 'step', id: step.id }, deps);
  const stepIds = new Set(stepSkills.map((skill) => skill.id));
  return [...agentSkills.filter((skill) => stepIds.has(skill.id) === false), ...stepSkills];
}

async function resolveAgentSkills(agentId: string, stepId: string, deps: ResolveSkillsForStepDeps): Promise<Skill[]> {
  const agent = await deps.agentDefinitionRepo.getById(agentId);
  if (agent === null) {
    throw new AgentDefinitionNotFoundError(agentId, stepId);
  }
  return resolveOfferedSkills(agent.skills ?? [], agent, { kind: 'agent', id: agent.id }, deps);
}

async function resolveOfferedSkills(
  refs: AgentSkillRef[],
  owner: Pick<AgentDefinition, 'namespace' | 'visibility'>,
  offerer: SkillOfferer,
  deps: ResolveSkillsForStepDeps,
): Promise<Skill[]> {
  const skills = await Promise.all(refs.map((ref) => deps.skillRepo.getById(ref.namespace, ref.id)));
  return refs.map((ref, index) => {
    const skill = skills[index] ?? null;
    if (skill === null || mayHoldSkill(owner, skill) === false) {
      throw new SkillNotFoundError(ref, offerer);
    }
    return skill;
  });
}
