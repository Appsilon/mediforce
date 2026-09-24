'use client';

import type { EvaluatedStep, StepQualificationStatus } from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { useStepQualification } from '@/hooks/use-step-evaluation';

const BADGES: Record<StepQualificationStatus, { label: string; className: string }> = {
  qualified: { label: 'Qualified', className: 'bg-green-500/10 text-green-700 dark:text-green-400' },
  stale: { label: 'Stale', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  not_qualified: { label: 'Not qualified', className: 'bg-muted text-muted-foreground' },
};

export function QualificationStatusChip({ status, title }: { status: StepQualificationStatus; title?: string }) {
  const badge = BADGES[status];
  return (
    <span title={title} data-testid="step-qualification-badge" data-status={status} className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', badge.className)}>
      {badge.label}
    </span>
  );
}

/**
 * A Step's qualification badge (ADR-0023 D11) — informational, it blocks
 * nothing. With `definitionVersion`, for the step as that version has it:
 * what a run of that version ran. Renders nothing while loading or when the
 * step cannot be evaluated.
 */
export function StepQualificationBadge({ step, definitionVersion }: { step: EvaluatedStep; definitionVersion?: number }) {
  const { data } = useStepQualification(step, definitionVersion);
  if (data === undefined) return null;
  const title = data.status === 'stale'
    ? `The step changed since it was qualified: ${data.changed.join(', ')}`
    : data.qualification === null
      ? 'No Step Qualification was signed for this step'
      : `Qualified by ${data.qualification.signature.signerName} on ${data.qualification.signature.signedAt.slice(0, 10)}`;
  return <QualificationStatusChip status={data.status} title={title} />;
}
