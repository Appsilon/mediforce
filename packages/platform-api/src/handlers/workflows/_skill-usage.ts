import {
  pickRunnableVersion,
  type AgentSkillRef,
  type WorkflowDefinition,
  type WorkflowDefinitionGroup,
} from '@mediforce/platform-core';

/** What the runnable version of one workflow asks of the Skill catalog. */
export interface WorkflowSkillUsage {
  namespace: string;
  name: string;
  title: string | undefined;
  visibility: WorkflowDefinition['visibility'];
  /** Skills named in a step's own `agent.skills`. */
  directSkills: AgentSkillRef[];
  /** Agent definitions the steps reference, whose Skills the step inherits. */
  agentIds: string[];
}

/**
 * The Skills each workflow runs with, from the version a run starts from.
 * Agent-held Skills are not resolved here: that needs the agent definitions,
 * which the caller already holds.
 */
export function findWorkflowSkillUsage(
  groups: readonly WorkflowDefinitionGroup[],
): WorkflowSkillUsage[] {
  const usages: WorkflowSkillUsage[] = [];
  for (const group of groups) {
    const definition = pickRunnableVersion(group.versions, group.defaultVersion);
    if (definition === null || definition === undefined) continue;

    const directSkills = new Map<string, AgentSkillRef>();
    const agentIds = new Set<string>();
    for (const step of definition.steps) {
      for (const ref of step.agent?.skills ?? []) {
        directSkills.set(`${ref.namespace}/${ref.id}`, ref);
      }
      if (step.agentId !== undefined) agentIds.add(step.agentId);
    }
    if (directSkills.size === 0 && agentIds.size === 0) continue;

    usages.push({
      namespace: definition.namespace,
      name: definition.name,
      title: definition.title,
      visibility: definition.visibility,
      directSkills: [...directSkills.values()],
      agentIds: [...agentIds],
    });
  }
  return usages;
}
