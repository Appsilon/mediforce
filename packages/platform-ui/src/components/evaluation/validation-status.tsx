'use client';

import Link from 'next/link';
import { CircleCheck, CircleX, Clock, type LucideIcon } from 'lucide-react';
import type { StepValidation, WorkflowVersionValidation } from '@mediforce/platform-api/contract';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

type ValidationStatus = StepValidation['status'];

/** How a step's validation, or a workflow version's rolled up across its agent steps, reads. */
export const VALIDATION_STATUS: Record<ValidationStatus, {
  label: string;
  versionLabel: string;
  symbol: string;
  icon: LucideIcon;
  textClassName: string;
  buttonClassName: string;
}> = {
  passed: {
    label: 'Validation passed',
    versionLabel: 'Verified',
    symbol: '✓',
    icon: CircleCheck,
    textClassName: 'text-green-700 dark:text-green-400',
    buttonClassName: 'border-green-600/40 bg-green-600/10 text-green-700 hover:bg-green-600/15 dark:text-green-400',
  },
  failed: {
    label: 'Validation failed',
    versionLabel: 'Failed',
    symbol: '✗',
    icon: CircleX,
    textClassName: 'text-red-700 dark:text-red-400',
    buttonClassName: 'border-red-600/40 bg-red-600/10 text-red-700 hover:bg-red-600/15 dark:text-red-400',
  },
  not_verified: {
    label: 'Not verified',
    versionLabel: 'Not verified',
    symbol: '○',
    icon: Clock,
    textClassName: 'text-muted-foreground',
    buttonClassName: 'border-border bg-muted/60 text-muted-foreground hover:bg-muted',
  },
};

/** What a version's status rests on: each agent step's validation in it. */
function describeVersionValidation(version: WorkflowVersionValidation): string {
  if (version.steps.length === 0) return 'No agent steps to verify.';
  return version.steps
    .map((step) => `${step.stepName}: ${VALIDATION_STATUS[step.validation.status].label.toLowerCase()}`)
    .join(' · ');
}

/**
 * A workflow version's badge: Verified when every agent step passed its
 * Acceptance Criteria in it. Links to the version on the Evaluation tab, on
 * its first failed step, else its first not verified one, else its first.
 * Renders nothing for a version without agent steps.
 */
export function VersionValidationBadge({ handle, workflowName, version }: { handle: string; workflowName: string; version: WorkflowVersionValidation }) {
  if (version.steps.length === 0) return null;
  const display = VALIDATION_STATUS[version.status];
  const shown = version.steps.find((step) => step.validation.status === 'failed')
    ?? version.steps.find((step) => step.validation.status === 'not_verified')
    ?? version.steps[0]!;
  return (
    <Link
      href={routes.workflowEvaluation(handle, workflowName, { version: version.definitionVersion, step: shown.stepId })}
      title={describeVersionValidation(version)}
      data-testid="version-validation-badge"
      data-status={version.status}
      className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', display.buttonClassName)}
    >
      <display.icon className="h-3 w-3" aria-hidden />
      {display.versionLabel}
    </Link>
  );
}
