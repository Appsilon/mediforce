'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { EvaluatedStep, JudgeReviewDecision, JudgeVerdict } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { cn } from '@/lib/utils';
import { useEvalRunMutation } from '@/hooks/use-step-evaluation';
import { InstantTooltip } from '@/components/ui/instant-tooltip';
import { buttonClass, inputClass, primaryButtonClass } from './evaluation-styles';

const DECISION_VERBS: Record<JudgeReviewDecision, string> = { accepted: 'accept', denied: 'deny' };

const DECIDED_CLASSES: Record<JudgeReviewDecision, string> = {
  accepted: 'border-green-600 bg-green-500/15 text-green-700 dark:text-green-400',
  denied: 'border-red-600 bg-red-500/15 text-red-700 dark:text-red-400',
};

/** Whether a verdict counts toward the Acceptance Criteria, and what decided it. */
function standing(verdict: JudgeVerdict): string {
  if (verdict.review?.decision === 'denied') return `left out — denied by ${verdict.review.reviewedBy ?? 'a person'}`;
  if (verdict.review?.decision === 'accepted') return `counts — accepted by ${verdict.review.reviewedBy ?? 'a person'}`;
  return verdict.counts ? 'counts' : 'left out — below its minimum confidence';
}

function confidenceText(verdict: JudgeVerdict): string {
  if (verdict.agreement !== null) return `agreement ${verdict.agreement}`;
  if (verdict.confidence === null) return 'no confidence reported';
  const below = verdict.minConfidence !== null && verdict.confidence < verdict.minConfidence;
  return `confidence ${verdict.confidence}${below ? ` (below ${verdict.minConfidence})` : ''}`;
}

/** One model verdict with its rationale, and the Accept / Deny a person reviews it with. */
export function JudgeVerdictRow({ step, evalRunId, verdict, mayEdit, editReason, trialHref, rationale }: {
  step: EvaluatedStep;
  evalRunId: string;
  verdict: JudgeVerdict;
  mayEdit: boolean;
  editReason: string | undefined;
  /** Where the trial's details are; omitted on the trial's own page. */
  trialHref?: string;
  /** The rationale as the page renders it; its plain text by default. */
  rationale?: React.ReactNode;
}) {
  const [deciding, setDeciding] = React.useState<JudgeReviewDecision | null>(null);
  const [comment, setComment] = React.useState('');
  const decided = verdict.review?.decision;
  const review = useEvalRunMutation(step, evalRunId, (decision: JudgeReviewDecision) => mediforce.evaluation.reviewJudgeVerdict({
    evalRunId,
    trialId: verdict.trialId,
    evaluatorId: verdict.evaluatorId,
    decision,
    ...(comment.trim() === '' ? {} : { comment: comment.trim() }),
  }));
  const confirm = (decision: JudgeReviewDecision) => review.mutate(decision, {
    onSuccess: () => {
      setDeciding(null);
      setComment('');
    },
  });
  return (
    <li className="space-y-1 border-t pt-2 first:border-t-0 first:pt-0" data-testid="judge-verdict">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-medium">{verdict.caseName ?? verdict.caseId.slice(0, 8)} · trial {verdict.trialIndex + 1}</span>
        <span className="text-muted-foreground">{verdict.name}</span>
        <span className={cn(
          'rounded px-1.5 py-0.5 text-[11px] font-medium',
          verdict.passed ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-red-500/10 text-red-700 dark:text-red-400',
        )}>{verdict.passed ? 'pass' : 'fail'}</span>
        <span className="text-muted-foreground">{confidenceText(verdict)}</span>
        <span className={cn(verdict.counts ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-300')}>{standing(verdict)}</span>
        {trialHref !== undefined && (
          <Link href={trialHref} className="ml-auto inline-flex items-center gap-0.5 text-primary hover:underline">
            What the judge read <ChevronRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      <p className="whitespace-pre-wrap" data-testid="judge-rationale">{rationale ?? verdict.rationale ?? 'The judge gave no rationale.'}</p>
      {verdict.review?.comment !== null && verdict.review?.comment !== undefined && (
        <p className="text-muted-foreground">Reviewer: {verdict.review.comment}</p>
      )}
      {deciding === null ? (
        <InstantTooltip label={mayEdit ? undefined : editReason}>
          <span className="inline-flex gap-1.5">
            <button type="button" className={cn(buttonClass, decided === 'accepted' && DECIDED_CLASSES.accepted)} disabled={mayEdit === false} onClick={() => setDeciding('accepted')}>Accept</button>
            <button type="button" className={cn(buttonClass, decided === 'denied' && DECIDED_CLASSES.denied)} disabled={mayEdit === false} onClick={() => setDeciding('denied')}>Deny</button>
          </span>
        </InstantTooltip>
      ) : (
        <div className="space-y-1 rounded-md border p-2">
          {decided !== undefined && decided !== deciding && (
            <p className="font-medium text-amber-700 dark:text-amber-300" data-testid="verdict-change-notice">
              You are changing the decision from {DECISION_VERBS[decided]} to {DECISION_VERBS[deciding]}.
            </p>
          )}
          <p>
            {deciding === 'accepted'
              ? 'Accepting counts this verdict toward the Acceptance Criteria as the judge gave it — a fail stays a fail — however unsure the judge was.'
              : 'Denying leaves this verdict out of the Acceptance Criteria, pass or fail. It does not flip the judge\'s verdict.'}
          </p>
          <textarea
            aria-label="Why (optional)"
            className={cn(inputClass, 'w-full min-h-12 text-xs')}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          {review.error !== null && <p className="text-destructive">{review.error.message}</p>}
          <div className="flex gap-1.5">
            <button type="button" className={primaryButtonClass} disabled={review.isPending} onClick={() => confirm(deciding)}>
              Confirm {DECISION_VERBS[deciding]}
            </button>
            <button type="button" className={buttonClass} onClick={() => setDeciding(null)}>Cancel</button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Every model's verdict in an Eval Run (ADR-0023) — a judge's, or an
 * expected-output agreement score: pass or fail, the judge's confidence
 * against its minimum or the agreement, and its rationale — what decided it
 * and why, with a link to everything the judge read. A person accepts a
 * verdict, so it counts however unsure the judge was, or denies it, leaving it
 * out of the Acceptance Criteria.
 */
export function JudgeVerdicts({ step, evalRunId, verdicts, mayEdit, editReason, trialHref }: {
  step: EvaluatedStep;
  evalRunId: string;
  verdicts: readonly JudgeVerdict[];
  mayEdit: boolean;
  editReason: string | undefined;
  trialHref?: (trialId: string) => string;
}) {
  const leftOut = verdicts.filter((verdict) => verdict.counts === false).length;
  return (
    <div className="space-y-2 text-xs">
      <p className="text-muted-foreground" data-testid="judge-verdicts-summary">
        Model verdicts — {verdicts.length}{leftOut > 0 ? `, ${leftOut} left out of the criteria` : ''}
      </p>
      <ul className="space-y-2">
        {verdicts.map((verdict) => (
          <JudgeVerdictRow
            key={`${verdict.trialId}:${verdict.evaluatorId}`}
            step={step}
            evalRunId={evalRunId}
            verdict={verdict}
            mayEdit={mayEdit}
            editReason={editReason}
            trialHref={trialHref?.(verdict.trialId)}
          />
        ))}
      </ul>
    </div>
  );
}
