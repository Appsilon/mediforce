import {
  agentMayHoldSkill,
  type AgentDefinitionRepository,
  type AgentSkillRef,
  type Skill,
  type WorkflowStep,
} from '@mediforce/platform-core';
import { AgentDefinitionNotFoundError } from '../mcp/resolve-mcp-for-step';

/** Raised when an agent holds a Skill that no longer exists, or that it may no
 *  longer reach. A broken reference must surface, not quietly mean "no skills". */
export class SkillNotFoundError extends Error {
  public readonly namespace: string;
  public readonly skillId: string;
  public readonly agentId: string;

  constructor(ref: AgentSkillRef, agentId: string) {
    super(
      `Skill '${ref.namespace}/${ref.id}' (held by agent '${agentId}') not found, ` +
      'or not reachable by the agent; remove it from the agent or restore the skill',
    );
    this.name = 'SkillNotFoundError';
    this.namespace = ref.namespace;
    this.skillId = ref.id;
    this.agentId = agentId;
  }
}

export interface ResolveSkillsForStepDeps {
  agentDefinitionRepo: Pick<AgentDefinitionRepository, 'getById'>;
  skillRepo: { getById(namespace: string, id: string): Promise<Skill | null> };
}

/** Resolve the Skills a workflow step's agent holds (ADR-0025 decision 4).
 *
 *  Contract, the same as resolveMcpForStep:
 *   - step.agentId unset → null.
 *   - AgentDefinition missing → AgentDefinitionNotFoundError.
 *   - a reference to a Skill that is gone, or that the agent may no longer
 *     hold → SkillNotFoundError.
 *   - otherwise the Skills in the agent's order; [] when it holds none.
 *
 *  Each Skill resolves in the namespace its reference names, never the
 *  workflow's. */
export async function resolveSkillsForStep(
  step: WorkflowStep,
  deps: ResolveSkillsForStepDeps,
): Promise<Skill[] | null> {
  if (step.agentId === undefined) return null;

  const agent = await deps.agentDefinitionRepo.getById(step.agentId);
  if (agent === null) {
    throw new AgentDefinitionNotFoundError(step.agentId, step.id);
  }

  const refs = agent.skills ?? [];
  const skills = await Promise.all(refs.map((ref) => deps.skillRepo.getById(ref.namespace, ref.id)));
  return refs.map((ref, index) => {
    const skill = skills[index] ?? null;
    if (skill === null || agentMayHoldSkill(agent, skill) === false) {
      throw new SkillNotFoundError(ref, agent.id);
    }
    return skill;
  });
}
