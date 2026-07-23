import type { WorkflowStep } from '@mediforce/platform-core';
import type { RegistrationWarning } from '@mediforce/platform-api/contract';
import type { ToastOpts } from '@/components/command-palette/types';
import { ApiError } from '@/lib/mediforce';
import { formatStepName } from '@/lib/format';

export type ValidationIssue = { path: (string | number)[]; message: string };

export const DISPLAY_NAME_KEY = 'displayName';

export function workflowDisplayName(
  def: { name: string; metadata?: Record<string, unknown> | null },
): string {
  const dn = def.metadata?.[DISPLAY_NAME_KEY];
  return typeof dn === 'string' && dn.trim().length > 0 ? dn : formatStepName(def.name);
}

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

export function validateSteps(steps: WorkflowStep[]): string | null {
  const missingPlugin = steps.filter(
    (s) => s.type !== 'terminal' && (s.executor === 'agent' || s.executor === 'script') && !s.plugin,
  );
  if (missingPlugin.length > 0) {
    return `Plugin required for agent/script steps: ${missingPlugin.map((s) => `"${s.name}"`).join(', ')}`;
  }

  const missingAction = steps.filter((s) => s.executor === 'action' && !s.action);
  if (missingAction.length > 0) {
    return `Action config required: ${missingAction.map((s) => `"${s.name}"`).join(', ')}`;
  }
  const missingScript = steps.filter((s) => s.executor === 'script' && !s.script && !s.databricks);
  if (missingScript.length > 0) {
    return `Script config required: ${missingScript.map((s) => `"${s.name}"`).join(', ')}`;
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

export function reportSaveError(
  err: unknown,
  steps: WorkflowStep[],
  toast: (opts: ToastOpts) => void,
): { displayMessage: string; stepErrors: Record<string, Record<string, string>> } {
  const issues = err instanceof ApiError && Array.isArray(err.details)
    ? (err.details as ValidationIssue[])
    : [];
  const stepErrors = parseStepErrors(issues, steps);
  const message = err instanceof ApiError ? err.message
    : err instanceof Error ? err.message : 'Unknown error';
  const displayMessage = Object.keys(stepErrors).length > 0
    ? 'Some steps have errors — check the highlighted steps in the diagram.'
    : message;
  toast({ title: 'Save failed', description: displayMessage, variant: 'error' });
  return { displayMessage, stepErrors };
}
