import type { Verdict } from './process-definition.js';

/** Default UI label for a verdict key. Server-side fallback so UI stays dumb. */
export function defaultVerdictLabel(key: string): string {
  if (key === 'approve') return 'Approve';
  if (key === 'revise') return 'Request revisions';
  return key
    .split(/[_-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function defaultVerdictIntent(key: string): 'success' | 'danger' | 'warning' | 'neutral' {
  if (key === 'approve') return 'success';
  if (key === 'revise') return 'warning';
  return 'neutral';
}

export function defaultRequiresComment(key: string): boolean {
  return key === 'revise';
}

/** Resolved verdict descriptor for HumanTask (no target — server-side only). */
export interface TaskVerdict {
  label: string;
  intent: 'success' | 'danger' | 'warning' | 'neutral';
  requiresComment: boolean;
}

/** Build the verdicts payload attached to a HumanTask: strip target, fill defaults. */
export function buildTaskVerdicts(
  stepVerdicts: Record<string, Verdict> | undefined,
): Record<string, TaskVerdict> | undefined {
  if (!stepVerdicts || Object.keys(stepVerdicts).length === 0) return undefined;
  const out: Record<string, TaskVerdict> = {};
  for (const [key, cfg] of Object.entries(stepVerdicts)) {
    out[key] = {
      label: cfg.label ?? defaultVerdictLabel(key),
      intent: cfg.intent ?? defaultVerdictIntent(key),
      requiresComment: cfg.requiresComment ?? defaultRequiresComment(key),
    };
  }
  return out;
}

/** Used by resolve-task to validate submitted verdict against step config. */
export function isVerdictAllowed(
  stepVerdicts: Record<string, { target: string }> | undefined,
  verdictKey: string,
): boolean {
  if (!stepVerdicts) return false;
  return verdictKey in stepVerdicts;
}
