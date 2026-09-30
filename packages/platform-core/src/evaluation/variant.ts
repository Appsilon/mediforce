import type { StepVariantPatch } from '../schemas/evaluation';
import type { WorkflowDefinition, WorkflowStep } from '../schemas/workflow-definition';
import { narrowMcpRestrictions } from './mcp-eval-restrictions';

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
