import type { ModelRegistryEntry } from '@mediforce/platform-core';
import { validateRetiredModels, validateWorkflowModels } from '@mediforce/agent-runtime';
import type { RetiredModelRef, UnknownModel } from '@mediforce/agent-runtime';

export type { RetiredModelRef, UnknownModel };

/**
 * The agent steps naming a model the registry does not list. Read on the
 * definition as written: an agent's foundationModel was never registry-checked,
 * so an inherited model is not held to this.
 */
export function checkUnknownModels(
  workflowDefinition: Parameters<typeof validateWorkflowModels>[0],
  allModels: ModelRegistryEntry[],
): { unknownModels: UnknownModel[]; message: string } | null {
  const unknownModels = validateWorkflowModels(workflowDefinition, new Set(allModels.map((m) => m.id)));
  if (unknownModels.length === 0) return null;

  const detail = unknownModels
    .map((u) => `model '${u.model}' in step(s) ${u.steps.map((s) => `'${s.stepId}'`).join(', ')}`)
    .join('; ');
  return {
    unknownModels,
    message: `Unknown model(s): ${detail}. Check the model name or sync the model registry.`,
  };
}

export function checkRetiredModels(
  workflowDefinition: Parameters<typeof validateRetiredModels>[0],
  allModels: ModelRegistryEntry[],
): { refs: RetiredModelRef[]; message: string } | null {
  const retiredMap = new Map(
    allModels
      .filter((m) => m.retiredAt !== null)
      .map((m) => [m.id, m.retiredAt!]),
  );
  const retiredRefs = validateRetiredModels(workflowDefinition, retiredMap);
  if (retiredRefs.length === 0) return null;

  const detail = retiredRefs
    .map((r) => {
      const stepNames = r.steps.map((s) => `'${s.stepName}'`).join(', ');
      const date = r.retiredAt.slice(0, 10);
      return `model '${r.model}' (retired ${date}) in step(s) ${stepNames}`;
    })
    .join('; ');

  return {
    refs: retiredRefs,
    message: `Cannot run: step(s) use retired model(s): ${detail}`,
  };
}
