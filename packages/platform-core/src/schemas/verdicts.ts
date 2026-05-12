import type { Verdict } from './process-definition.js';

/** Default UI label for a verdict key. Server-side fallback so UI stays dumb. */
export function defaultVerdictLabel(key: string): string {
  if (key === 'approve') return 'Approve';
  if (key === 'revise') return 'Request changes';
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

/** Resolved verdict descriptor for HumanTask. Carries its own key so the
 *  array shape preserves WD insertion order through Firestore + React. */
export interface TaskVerdict {
  key: string;
  label: string;
  intent: 'success' | 'danger' | 'warning' | 'neutral';
  requiresComment: boolean;
}

/** Build the verdicts payload attached to a HumanTask: strip target, fill defaults.
 *  Returned as an ordered array (NOT a Record) so button order matches the WD. */
export function buildTaskVerdicts(
  stepVerdicts: Record<string, Verdict> | undefined,
): TaskVerdict[] | undefined {
  if (!stepVerdicts || Object.keys(stepVerdicts).length === 0) return undefined;
  return Object.entries(stepVerdicts).map(([key, cfg]) => ({
    key,
    label: cfg.label ?? defaultVerdictLabel(key),
    intent: cfg.intent ?? defaultVerdictIntent(key),
    requiresComment: cfg.requiresComment ?? defaultRequiresComment(key),
  }));
}

