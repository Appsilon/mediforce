import { z } from 'zod';
import type { WorkflowStep } from '@mediforce/platform-core';
import type { RegistrationWarning } from '@mediforce/platform-api/contract';
import type { ToastOpts } from '@/components/command-palette/types';
import { formatStepName } from '@/lib/format';

/**
 * A serialized Zod issue as it survives the API boundary in
 * `ApiError.details`. Only `path` and `message` are guaranteed; the rest are
 * the discriminating fields Zod attaches per issue code, which is what lets
 * the message be rebuilt without pattern-matching English prose.
 */
const ValidationIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])).catch([]),
  message: z.string().catch(''),
  code: z.string().optional(),
  expected: z.string().optional(),
  origin: z.string().optional(),
  minimum: z.number().optional(),
  values: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

const MAX_REPORTED_ISSUES = 4;

export const DISPLAY_NAME_KEY = 'displayName';

/**
 * Counts step parameters by trimmed name, so "amount" and "amount " collide
 * the same way the blank-name check already treats them as equivalent.
 */
export function paramNameCounts(params: { name: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of params) {
    const name = p.name.trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

export function workflowDisplayName(
  def: { name: string; metadata?: Record<string, unknown> | null },
): string {
  const dn = def.metadata?.[DISPLAY_NAME_KEY];
  return typeof dn === 'string' && dn.trim().length > 0 ? dn : formatStepName(def.name);
}

/**
 * Maps server-side validation issues back to per-step field errors.
 * Keyed by stepId → fieldName → message.
 */
function parseStepErrors(
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

export interface SaveFailure {
  stepErrors: Record<string, Record<string, string>>;
  message: string;
}

/**
 * Turns a failed save into the two things the editor renders: per-step field
 * errors for the diagram, and one header message.
 *
 * The message is rebuilt from the structured issues in `ApiError.details`
 * rather than from the server's joined prose, so it names the offending field
 * and survives Zod changing its wording.
 */
export function handleSaveFailure(err: unknown, steps: WorkflowStep[]): SaveFailure {
  console.error('Workflow save failed', err);

  const issues = extractIssues(err);
  const stepErrors = parseStepErrors(issues, steps);
  if (Object.keys(stepErrors).length > 0) {
    return { stepErrors, message: 'Some steps have errors — check the highlighted steps in the diagram.' };
  }

  return { stepErrors, message: describeIssues(issues) ?? fallbackMessage(err) };
}

function extractIssues(err: unknown): ValidationIssue[] {
  const details: unknown = err instanceof Error && 'details' in err ? err.details : undefined;
  if (!Array.isArray(details)) return [];
  return details.flatMap((issue) => {
    const parsed = ValidationIssueSchema.safeParse(issue);
    return parsed.success ? [parsed.data] : [];
  });
}

/** `null` when there is nothing structured to report. */
function describeIssues(issues: ValidationIssue[]): string | null {
  if (issues.length === 0) return null;
  const reported = issues.slice(0, MAX_REPORTED_ISSUES).map(describeIssue);
  const omitted = issues.length - reported.length;
  const tail = omitted > 0 ? [`and ${omitted} more`] : [];
  return `${[...reported, ...tail].join('; ')}.`;
}

function describeIssue(issue: ValidationIssue): string {
  const field = issue.path.length > 0 ? issue.path.join('.') : 'The workflow';
  const problem = describeProblem(issue);
  return problem === null ? `${field}: ${issue.message}` : `${field} ${problem}`;
}

function describeProblem(issue: ValidationIssue): string | null {
  if (issue.code === 'too_small' && issue.minimum === 1) return 'is required';
  if (issue.code === 'invalid_type' && issue.expected !== undefined) {
    return `must be a ${issue.expected}`;
  }
  if (issue.values !== undefined && issue.values.length > 0) {
    return `must be one of: ${issue.values.join(', ')}`;
  }
  return null;
}

function fallbackMessage(err: unknown): string {
  const message = err instanceof Error ? err.message.trim() : '';
  return message === '' ? 'Unable to save the workflow. Please try again.' : message;
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

  const emptyParamSteps = steps.filter((s) => (s.params ?? []).some((p) => p.name.trim() === ''));
  if (emptyParamSteps.length > 0) {
    return `Parameter name cannot be empty on: ${emptyParamSteps.map((s) => `"${s.name}"`).join(', ')}`;
  }

  const dupeParamNames = steps.flatMap((s) => (
    [...paramNameCounts(s.params ?? []).entries()]
      .filter(([, count]) => count > 1)
      .map(([name]) => `"${name}" on step "${s.name}"`)
  ));
  if (dupeParamNames.length > 0) {
    return `Duplicate parameter name: ${dupeParamNames.join(', ')}`;
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

