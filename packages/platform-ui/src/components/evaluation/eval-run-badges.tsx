'use client';

import type { EvalRunAcceptance, EvalRunStatus, EvalTrialOutcome, EvalTrialStatus } from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { InstantTooltip } from '@/components/ui/instant-tooltip';

const badgeClass = 'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap';
const GREEN = 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
const RED = 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
const AMBER = 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
const BLUE = 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
const GRAY = 'bg-gray-100 text-gray-700 dark:bg-gray-800/60 dark:text-gray-400';

const RUN_STATUS: Record<EvalRunStatus, { label: string; className: string }> = {
  prepared: { label: 'Waiting to start', className: AMBER },
  running: { label: 'Running', className: BLUE },
  completed: { label: 'Completed', className: GREEN },
  budget_exceeded: { label: 'Budget reached', className: AMBER },
  cancelled: { label: 'Cancelled', className: GRAY },
};

export function EvalRunStatusBadge({ status }: { status: EvalRunStatus }) {
  return <span className={cn(badgeClass, RUN_STATUS[status].className)} data-testid="eval-run-status">{RUN_STATUS[status].label}</span>;
}

const ACCEPTANCE: Record<EvalRunAcceptance['status'], { label: string; className: string }> = {
  met: { label: 'Met', className: GREEN },
  missed: { label: 'Missed', className: RED },
  not_judged: { label: 'Not judged', className: AMBER },
  no_criteria: { label: 'No criteria', className: GRAY },
};

/** How the run's champion fared on its Acceptance Criteria; a dash while it is prepared or running. */
export function AcceptanceBadge({ acceptance }: { acceptance: EvalRunAcceptance | null }) {
  if (acceptance === null) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <InstantTooltip label={acceptance.reason}>
      <span className={cn(badgeClass, ACCEPTANCE[acceptance.status].className)} data-testid="eval-run-acceptance">
        {ACCEPTANCE[acceptance.status].label}
      </span>
    </InstantTooltip>
  );
}

const OUTCOME: Record<EvalTrialOutcome, { label: string; className: string; meaning: string }> = {
  pass: { label: 'pass', className: GREEN, meaning: 'Passed' },
  fail: { label: 'fail', className: RED, meaning: 'Failed' },
  excluded: { label: 'left out', className: AMBER, meaning: 'A model verdict left out of the criteria — below its minimum confidence, or denied by a person' },
  errored: { label: 'error', className: AMBER, meaning: 'The check could not grade this trial' },
};

/** How one Evaluator graded one trial. */
export function OutcomeChip({ outcome, detail }: { outcome: EvalTrialOutcome; detail?: string | null }) {
  const { label, className, meaning } = OUTCOME[outcome];
  return (
    <InstantTooltip label={detail === undefined || detail === null ? meaning : `${meaning}: ${detail}`}>
      <span className={cn('inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium', className)} data-testid="trial-outcome">{label}</span>
    </InstantTooltip>
  );
}

const TRIAL_STATUS: Record<EvalTrialStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: GRAY },
  running: { label: 'Running', className: BLUE },
  scoring: { label: 'Scoring', className: BLUE },
  scored: { label: 'Scored', className: GREEN },
  failed: { label: 'Failed', className: RED },
  skipped: { label: 'Skipped', className: GRAY },
};

export function TrialStatusBadge({ status }: { status: EvalTrialStatus }) {
  return <span className={cn(badgeClass, TRIAL_STATUS[status].className)}>{TRIAL_STATUS[status].label}</span>;
}

/** Whether a trial passed every counted Evaluator; null when one did not grade it. */
export function TrialResultBadge({ passed }: { passed: boolean | null }) {
  if (passed === null) return <span className="text-xs text-muted-foreground">—</span>;
  return <span className={cn(badgeClass, passed ? GREEN : RED)}>{passed ? 'Passed' : 'Failed'}</span>;
}
