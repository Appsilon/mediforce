import type { WorkflowStep } from '@mediforce/platform-core';
import type { ValidationIssue } from '@/app/actions/definitions';

type Transitions = { from: string; to: string; when?: string }[];

/**
 * Maps server-side validation issues back to per-step field errors.
 * Keyed by stepId → fieldName → message.
 */
export function parseStepErrors(
  issues: ValidationIssue[],
  steps: WorkflowStep[],
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  for (const issue of issues) {
    if (issue.path[0] === 'steps' && typeof issue.path[1] === 'number') {
      const step = steps[issue.path[1]];
      const field = String(issue.path[2] ?? 'unknown');
      const key = step?.id || `__index_${issue.path[1]}`;
      result[key] = { ...(result[key] ?? {}), [field]: issue.message };
    }
  }
  return result;
}

/**
 * Validates steps for known structural errors before saving.
 * Returns an error message string on failure, or null when valid.
 */
export function validateSteps(steps: WorkflowStep[]): string | null {
  const missingPlugin = steps.filter(
    (s) => s.type !== 'terminal' && (s.executor === 'agent' || s.executor === 'script') && !s.plugin,
  );
  if (missingPlugin.length > 0) {
    return `Plugin required for agent/script steps: ${missingPlugin.map((s) => `"${s.name}"`).join(', ')}`;
  }

  const emptyIds = steps.filter((s) => !s.id);
  if (emptyIds.length > 0) {
    return `Step ID is empty for: ${emptyIds.map((s) => `"${s.name}"`).join(', ')}`;
  }

  const idCounts = new Map<string, number>();
  for (const s of steps) idCounts.set(s.id, (idCounts.get(s.id) ?? 0) + 1);
  const dupes = [...idCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  if (dupes.length > 0) {
    return `Duplicate step IDs: ${dupes.join(', ')}`;
  }

  return null;
}

/**
 * Adds implicit transitions derived from review-step verdicts so the saved
 * definition graph is complete even when the canvas only shows one outgoing
 * edge per review step.
 */
export function mergeVerdictTransitions(steps: WorkflowStep[], transitions: Transitions): Transitions {
  const merged = [...transitions];
  for (const step of steps) {
    if (step.type === 'review' && step.verdicts) {
      for (const verdict of Object.values(step.verdicts)) {
        if (verdict.target && !merged.some((t) => t.from === step.id && t.to === verdict.target)) {
          merged.push({ from: step.id, to: verdict.target });
        }
      }
    }
  }
  return merged;
}
