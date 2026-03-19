import type { ProcessInstance, Step, WorkflowDefinition } from '@mediforce/platform-core';

interface LegacyDefinition {
  version: string;
  steps: Step[];
}

/**
 * Resolve definition steps from either legacy processDefinitions or new workflowDefinitions.
 * Handles dual-source lookup for backward compatibility.
 */
export function resolveDefinitionSteps(
  instance: ProcessInstance | null,
  legacyVersions: LegacyDefinition[],
  workflowVersions: WorkflowDefinition[],
): Step[] {
  if (!instance) return [];

  // Try legacy processDefinitions first (exact version match)
  const legacyMatch = legacyVersions.find((v) => v.version === instance.definitionVersion);
  if (legacyMatch?.steps?.length) return legacyMatch.steps;

  // Fall back to workflowDefinitions (version is number, definitionVersion is string)
  const versionNum = parseInt(instance.definitionVersion, 10);
  if (!isNaN(versionNum)) {
    const workflowMatch = workflowVersions.find((v) => v.version === versionNum);
    if (workflowMatch?.steps?.length) return workflowMatch.steps;
  }

  // Last resort: return steps from latest available definition
  if (legacyVersions.length > 0) return legacyVersions[0].steps ?? [];
  if (workflowVersions.length > 0) return workflowVersions[0].steps;

  return [];
}
