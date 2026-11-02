import type { StepComment, Verdict } from './process-definition';

export const AGENT_REVIEW_VERDICT_KEYS = ['approve', 'revise'] as const;

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

export function resolveRequiresComment(
  key: string,
  verdict: Pick<Verdict, 'requiresComment'> | undefined,
  comment: StepComment | undefined,
): boolean {
  return comment?.requiredForVerdicts.includes(key) ?? verdict?.requiresComment ?? defaultRequiresComment(key);
}

function buildTaskVerdict(key: string, cfg: Verdict | undefined, comment: StepComment | undefined): TaskVerdict {
  return {
    key,
    label: cfg?.label ?? defaultVerdictLabel(key),
    intent: cfg?.intent ?? defaultVerdictIntent(key),
    requiresComment: resolveRequiresComment(key, cfg, comment),
  };
}

/** Build the verdicts payload attached to a HumanTask: strip target, fill defaults.
 *  Returned as an ordered array (NOT a Record) so button order matches the WD. */
export function buildTaskVerdicts(
  stepVerdicts: Record<string, Verdict> | undefined,
  comment?: StepComment,
): TaskVerdict[] | undefined {
  if (!stepVerdicts || Object.keys(stepVerdicts).length === 0) return undefined;
  return Object.entries(stepVerdicts).map(([key, cfg]) => buildTaskVerdict(key, cfg, comment));
}

/** The verdicts of an L3 agent review task. The revision loop needs both keys,
 *  whether or not the step, usually of type `creation`, declares any verdicts. */
export function buildAgentReviewTaskVerdicts(
  stepVerdicts: Record<string, Verdict> | undefined,
  comment: StepComment | undefined,
): TaskVerdict[] {
  return AGENT_REVIEW_VERDICT_KEYS.map((key) => buildTaskVerdict(key, stepVerdicts?.[key], comment));
}

interface StepCommentContext {
  executor: string;
  verdicts?: Record<string, Verdict>;
  comment?: StepComment;
  params?: unknown[];
  ui?: unknown;
}

/** The verdicts a step's comment can be required for. A human step with none of
 *  its own shows approve and revise, unless params or a custom UI replace that
 *  form, in which case the task has no comment box at all. */
export function commentVerdictKeys(step: StepCommentContext): readonly string[] {
  if (step.executor === 'agent') return AGENT_REVIEW_VERDICT_KEYS;
  const declared = Object.keys(step.verdicts ?? {});
  if (declared.length > 0) return declared;
  const hasOwnForm = (step.params?.length ?? 0) > 0 || step.ui !== undefined;
  return hasOwnForm ? [] : AGENT_REVIEW_VERDICT_KEYS;
}

/** The verdicts of a human step's task. A step with none of its own gets them
 *  only to carry a comment setting, so every other task stays as it was. */
export function buildHumanTaskVerdicts(step: StepCommentContext): TaskVerdict[] | undefined {
  const declared = buildTaskVerdicts(step.verdicts, step.comment);
  if (declared !== undefined) return declared;
  if (step.comment === undefined || commentVerdictKeys(step).length === 0) return undefined;
  return buildAgentReviewTaskVerdicts(undefined, step.comment);
}

/** Any verdict in `requiredForVerdicts` makes a parameter required. Which verdict
 *  buttons it blocks is still per verdict, where a task has verdict buttons. */
export function isParamRequired(param: { required?: boolean; requiredForVerdicts?: string[] }): boolean {
  return param.required === true || (param.requiredForVerdicts?.length ?? 0) > 0;
}
