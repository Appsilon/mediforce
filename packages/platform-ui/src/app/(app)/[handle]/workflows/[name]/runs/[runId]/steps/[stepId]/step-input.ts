import type { WorkflowDefinition } from '@mediforce/platform-core';

export function isEntryStep(
  definition: Pick<WorkflowDefinition, 'transitions'> | null,
  stepId: string,
): boolean {
  return definition !== null && definition.transitions.every((transition) => transition.to !== stepId);
}
