'use client';

import * as React from 'react';
import { Check, CircleDot, Circle, ExternalLink } from 'lucide-react';
import { VERIFY_WORKFLOW_URL } from '@mediforce/platform-core';
import { cn } from '@/lib/utils';

export type LadderRungId = 'schema' | 'readiness' | 'dry-run' | 'run';

/** Live outcome of the workflow readiness check, when the surface has run it.
 *  `clear` is reserved for a check where every relevant probe completed and
 *  found nothing; a probe that failed reports `incomplete`, never a pass. */
export type ReadinessResult = 'checking' | 'clear' | 'incomplete' | { warnings: number };

interface VerificationLadderProps {
  /** Which rung the surface showing this ladder sits on. */
  activeRung: LadderRungId;
  /** Omitted on surfaces that have not run the readiness check (e.g. saving). */
  readiness?: ReadinessResult;
}

const RUNGS: Array<{ id: LadderRungId; title: string; question: string; hint: string }> = [
  {
    id: 'schema',
    title: 'Schema validation',
    question: 'Is the definition legal?',
    hint: 'Runs on every save.',
  },
  {
    id: 'readiness',
    title: 'Workflow readiness check',
    question: 'Are the image, secrets, model and credits it needs present?',
    hint: 'Runs in the app before a run starts.',
  },
  {
    id: 'dry-run',
    title: 'Dry Run',
    question: 'Is the workflow structured as I intended?',
    hint: 'Mocks agent and script work. Action steps still fire for real.',
  },
  {
    id: 'run',
    title: 'Run',
    question: 'Does the work produce what I wanted?',
    hint: 'The only check that answers this.',
  },
];

/**
 * Collapses a surface's readiness state into the one result the ladder shows.
 * `clear` is the narrowest branch on purpose: it requires the check to have
 * finished, found nothing, and skipped nothing.
 */
export function deriveReadinessResult(state: {
  /** False on surfaces where no readiness check runs (e.g. an unsaved workflow). */
  enabled: boolean;
  loading: boolean;
  warningCount: number;
  /** Relevant checks that could not run — see `findSkippedChecks`. */
  skippedCount: number;
}): ReadinessResult | undefined {
  if (!state.enabled) return undefined;
  if (state.loading) return 'checking';
  if (state.warningCount > 0) return { warnings: state.warningCount };
  if (state.skippedCount > 0) return 'incomplete';
  return 'clear';
}

function readinessHint(readiness: ReadinessResult): string {
  if (readiness === 'checking') return 'Checking…';
  if (readiness === 'clear') return 'All present.';
  if (readiness === 'incomplete') return 'Some checks could not run.';
  const { warnings } = readiness;
  return `${String(warnings)} warning${warnings === 1 ? '' : 's'} above.`;
}

/**
 * The four verification gates rendered as one progression, so a user asking
 * "will this work?" can see which check answers their question and how to
 * reach it. Every rung is always listed — hiding the ones that do not apply to
 * the current surface is what made the ladder invisible in the first place.
 */
export function VerificationLadder({ activeRung, readiness }: VerificationLadderProps) {
  const activeIndex = RUNGS.findIndex((rung) => rung.id === activeRung);

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="text-xs font-medium text-muted-foreground mb-2">
        Four checks, four different questions
      </p>
      <ol className="space-y-2">
        {RUNGS.map((rung, index) => {
          const state = index < activeIndex ? 'passed' : index === activeIndex ? 'current' : 'pending';
          const hint = rung.id === 'readiness' && readiness !== undefined
            ? readinessHint(readiness)
            : rung.hint;
          return (
            <li
              key={rung.id}
              data-testid={`rung-${rung.id}`}
              data-state={state}
              className="flex items-start gap-2"
            >
              {state === 'passed' ? (
                <Check className="h-3.5 w-3.5 shrink-0 mt-0.5 text-green-600 dark:text-green-400" />
              ) : state === 'current' ? (
                <CircleDot className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" />
              ) : (
                <Circle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground/40" />
              )}
              <div className="min-w-0">
                <p className={cn('text-xs', state === 'pending' ? 'text-muted-foreground' : 'font-medium')}>
                  {rung.title}
                </p>
                <p className="text-xs text-muted-foreground">{rung.question}</p>
                <p className="text-[11px] text-muted-foreground/70">{hint}</p>
              </div>
            </li>
          );
        })}
      </ol>
      <a
        href={VERIFY_WORKFLOW_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        Which check answers which question?
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}
