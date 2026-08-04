import type { WorkflowStep } from '@mediforce/platform-core';
import type { RegistrationWarning } from '@mediforce/platform-api/contract';
import type { ToastOpts } from '@/components/command-palette/types';

export type ValidationIssue = { path: (string | number)[]; message: string };

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
 * Builds the user-facing message shown in the save header after a failed save.
 * Step-scoped issues are already rendered inline on the diagram, so we only
 * point the user there; everything else is translated from raw server text
 * (Zod jargon, stray JSON envelopes) into plain English so the toast is
 * readable without inspecting the DOM.
 */
export function formatSaveErrorMessage(err: unknown, hasStepErrors: boolean): string {
  if (hasStepErrors) {
    return 'Some steps have errors — check the highlighted steps in the diagram.';
  }
  return friendlySaveErrorMessage(err instanceof Error ? err.message : '');
}

function friendlySaveErrorMessage(message: string): string {
  const trimmed = message.trim();
  if (trimmed === '') {
    return 'Unable to save the workflow. Please try again.';
  }
  if (looksLikeSerializedJson(trimmed)) {
    return 'The workflow could not be saved. Please check your inputs and try again.';
  }
  if (/^Invalid enum value/.test(trimmed)) {
    return 'A field has an invalid value.';
  }
  if (/^(String|Array) must contain at least/.test(trimmed)) {
    return 'A required field is empty or missing.';
  }
  if (/(?:^|[.;]\s)Expected .*, received/.test(trimmed)) {
    return 'A field has an invalid value.';
  }
  return trimmed;
}

function looksLikeSerializedJson(text: string): boolean {
  const first = text[0];
  if (first !== '{' && first !== '[') return false;
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === 'object' && parsed !== null;
  } catch {
    return false;
  }
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

export function toastRegistrationWarnings(
  warnings: RegistrationWarning[] | undefined,
  toast: (opts: ToastOpts) => void,
): void {
  if (!warnings?.length) return;
  toast({
    title: `Saved with ${warnings.length} warning(s)`,
    description: warnings.map((w) => w.message).join('\n'),
    variant: 'warning',
  });
}
