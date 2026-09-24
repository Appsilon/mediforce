import type { StepMcpRestriction } from '../schemas/agent-mcp-binding';
import type { StepVariantPatch } from '../schemas/evaluation';
import type { WorkflowDefinition, WorkflowStep } from '../schemas/workflow-definition';

/** `base` narrowed by `extra`: a server either disables stays disabled, and denied tools add up. */
export function narrowMcpRestrictions(base: StepMcpRestriction = {}, extra: StepMcpRestriction = {}): StepMcpRestriction {
  const merged: StepMcpRestriction = { ...base };
  for (const [name, restriction] of Object.entries(extra)) {
    const existing = merged[name] ?? {};
    const denyTools = [...new Set([...(existing.denyTools ?? []), ...(restriction.denyTools ?? [])])];
    merged[name] = {
      ...((existing.disable === true || restriction.disable === true) ? { disable: true } : {}),
      ...(denyTools.length === 0 ? {} : { denyTools }),
    };
  }
  return merged;
}

export function isEmptyVariantPatch(patch: StepVariantPatch): boolean {
  return Object.values(patch).every((value) => value === undefined);
}

/** Why a patch cannot apply to this workflow, or null when it can. */
export function variantPatchProblem(definition: Pick<WorkflowDefinition, 'externalSkillsRepo'>, patch: StepVariantPatch): string | null {
  if (patch.skillCommit !== undefined && definition.externalSkillsRepo === undefined) {
    return 'skillCommit moves the workflow\'s external skills repository, and this workflow has none';
  }
  return null;
}

/**
 * The Step as one variant of it runs (ADR-0023 D5): the patch applied over
 * the pinned Definition version. `model`, `prompt` and `allowedTools` replace
 * the step's own; `mcpRestrictions` narrow it; `skillCommit` moves the
 * workflow's external skills repository. The returned definition carries the
 * patched step, so everything that reads the step from it sees the variant.
 */
export function applyStepVariant(
  definition: WorkflowDefinition,
  step: WorkflowStep,
  patch: StepVariantPatch,
): { definition: WorkflowDefinition; step: WorkflowStep } {
  if (isEmptyVariantPatch(patch)) return { definition, step };
  const problem = variantPatchProblem(definition, patch);
  if (problem !== null) throw new Error(problem);

  const patched: WorkflowStep = {
    ...step,
    agent: {
      ...step.agent,
      ...(patch.model === undefined ? {} : { model: patch.model }),
      ...(patch.prompt === undefined ? {} : { prompt: patch.prompt }),
      ...(patch.allowedTools === undefined ? {} : { allowedTools: patch.allowedTools }),
    },
    ...(patch.mcpRestrictions === undefined ? {} : { mcpRestrictions: narrowMcpRestrictions(step.mcpRestrictions, patch.mcpRestrictions) }),
  };
  return {
    step: patched,
    definition: {
      ...definition,
      steps: definition.steps.map((candidate) => (candidate.id === step.id ? patched : candidate)),
      ...(patch.skillCommit === undefined || definition.externalSkillsRepo === undefined
        ? {}
        : { externalSkillsRepo: { ...definition.externalSkillsRepo, commit: patch.skillCommit } }),
    },
  };
}
