import type { ModelRegistryEntry } from '@mediforce/platform-core';
import { validateRetiredModels } from '@mediforce/agent-runtime';
import type { RetiredModelRef } from '@mediforce/agent-runtime';

export type { RetiredModelRef };

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
