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

  const defVersion = instance.definitionVersion;

  // New-style runs use integer versions (e.g. "1", "2") without dots.
  // Legacy runs use semver (e.g. "1.0.0").
  const isNewStyleVersion = /^\d+$/.test(defVersion);

  if (isNewStyleVersion) {
    // Prefer workflowDefinitions for new-style versions
    const versionNum = parseInt(defVersion, 10);
    const workflowMatch = workflowVersions.find((v) => v.version === versionNum);
    if (workflowMatch?.steps?.length) return workflowMatch.steps;

    // Fall back to legacy
    const legacyMatch = legacyVersions.find((v) => v.version === defVersion);
    if (legacyMatch?.steps?.length) return legacyMatch.steps;
  } else {
    // Legacy semver — prefer legacy processDefinitions
    const legacyMatch = legacyVersions.find((v) => v.version === defVersion);
    if (legacyMatch?.steps?.length) return legacyMatch.steps;

    // Fall back to workflow (unlikely but safe)
    const versionNum = parseInt(defVersion, 10);
    if (!isNaN(versionNum)) {
      const workflowMatch = workflowVersions.find((v) => v.version === versionNum);
      if (workflowMatch?.steps?.length) return workflowMatch.steps;
    }
  }

  // Last resort: return steps from latest available definition
  if (workflowVersions.length > 0) return workflowVersions[0].steps;
  if (legacyVersions.length > 0) return legacyVersions[0].steps ?? [];

  return [];
}
