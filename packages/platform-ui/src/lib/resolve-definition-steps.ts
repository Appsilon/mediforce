import type { ProcessInstance, Step, WorkflowDefinition } from '@mediforce/platform-core';

/**
 * Resolve definition steps from workflowDefinitions for a given process instance.
 */
export function resolveDefinitionSteps(
  instance: ProcessInstance | null,
  workflowVersions: WorkflowDefinition[],
): Step[] {
  if (!instance) return [];

  const defVersion = instance.definitionVersion;
  const versionNum = parseInt(defVersion, 10);

  if (!isNaN(versionNum)) {
    const workflowMatch = workflowVersions.find((v) => v.version === versionNum);
    if (workflowMatch?.steps?.length) return workflowMatch.steps;
  }

  // Last resort: return steps from latest available definition
  if (workflowVersions.length > 0) return workflowVersions[0].steps;

  return [];
}
