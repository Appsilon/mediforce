import {
  pickRunnableVersion,
  type WorkflowDefinition,
  type WorkflowDefinitionGroup,
} from '@mediforce/platform-core';

/** One step of the runnable version pinning the agent asked about. */
export interface WorkflowAgentUsageStep {
  stepId: string;
  /** The version the step pins (ADR-0029), or `null` when unset — the step
   *  then falls back to the Agent's current version. */
  pinnedVersion: number | null;
}

/** One workflow whose runnable version has a step naming the agent asked
 *  about. */
export interface WorkflowAgentUsage {
  namespace: string;
  name: string;
  title: string | undefined;
  visibility: WorkflowDefinition['visibility'];
  version: number;
  steps: WorkflowAgentUsageStep[];
}

/**
 * Which workflows currently run an Agent, from the version a run starts
 * from — never from run history. A run pins the version it started with
 * forever (ADR-0029), so reading runs to answer "where is this Agent used"
 * means every past run stays "used by" long after a workflow moved on, and
 * two steps named alike in different workflows collide on `stepId` alone.
 * The workflow definition's own `step.agentId` / `step.agentVersion` answer
 * both problems directly, the same way `findWorkflowSkillUsage` reads Skill
 * usage from the definition rather than from runs.
 */
export function findWorkflowAgentUsage(
  groups: readonly WorkflowDefinitionGroup[],
  agentId: string,
): WorkflowAgentUsage[] {
  const usages: WorkflowAgentUsage[] = [];
  for (const group of groups) {
    const definition = pickRunnableVersion(group.versions, group.defaultVersion);
    if (definition === null || definition === undefined) continue;

    const steps: WorkflowAgentUsageStep[] = [];
    for (const step of definition.steps) {
      if (step.agentId !== agentId) continue;
      steps.push({ stepId: step.id, pinnedVersion: step.agentVersion ?? null });
    }
    if (steps.length === 0) continue;

    usages.push({
      namespace: definition.namespace,
      name: definition.name,
      title: definition.title,
      visibility: definition.visibility,
      version: definition.version,
      steps,
    });
  }
  return usages;
}
