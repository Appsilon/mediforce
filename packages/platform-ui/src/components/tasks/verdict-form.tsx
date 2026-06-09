'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import type { TaskVerdict, StepParam } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { cn } from '@/lib/utils';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { INTENT_STYLES, type Intent } from './intent-styles';

interface VerdictFormProps {
  taskId: string;
  disabled: boolean; // True when no content to review
  remainingTaskCount?: number;
  /** Resolved verdict descriptors copied from the WD step in WD insertion
   *  order. When absent, the form falls back to the legacy approve/revise UI
   *  for older tasks. */
  verdicts?: TaskVerdict[];
  onCompleted?: () => void;
}

interface SubmittedData {
  verdict: string;
  intent: Intent;
  label: string;
  comment: string;
  timestamp: string;
}

const LEGACY_VERDICTS: TaskVerdict[] = [
  { key: 'approve', label: 'Approve', intent: 'success', requiresComment: false },
  { key: 'revise', label: 'Request changes', intent: 'warning', requiresComment: true },
];

export function RemainingTasksFooter({ remainingTaskCount }: { remainingTaskCount?: number }) {
  const handle = useHandleFromPath();
  return (
    <div className="text-sm text-muted-foreground">
      {remainingTaskCount !== undefined && remainingTaskCount > 0 ? (
        <span>
          You have {remainingTaskCount} more {remainingTaskCount === 1 ? 'task' : 'tasks'} &mdash;{' '}
          <Link href={`/${handle}/tasks`} className="text-primary hover:underline font-medium">
            View next task
          </Link>
        </span>
      ) : (
        <Link href={`/${handle}/tasks`} className="text-primary hover:underline font-medium">
          Back to tasks
        </Link>
      )}
    </div>
  );
}

export function VerdictButtons({
  verdicts,
  submitting,
  trimmedComment,
  outerBlocked,
  outerBlockedHint,
  onVerdict,
}: {
  verdicts: TaskVerdict[];
  submitting: string | null;
  trimmedComment: string;
  outerBlocked?: boolean;
  outerBlockedHint?: string;
  onVerdict: (cfg: TaskVerdict) => void;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      {verdicts.map((cfg) => {
        const commentBlocked = cfg.requiresComment && !trimmedComment;
        const isSubmittingThis = submitting === cfg.key;
        const isDisabled = submitting !== null || !!outerBlocked || commentBlocked;
        return (
          <div key={cfg.key} className="flex flex-col items-start gap-1">
            <button
              type="button"
              onClick={() => onVerdict(cfg)}
              disabled={isDisabled}
              className={cn(
                'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
                INTENT_STYLES[cfg.intent].submit,
                isDisabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              {isSubmittingThis
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <IntentIcon intent={cfg.intent} className="h-4 w-4" />}
              {cfg.label}
            </button>
            {outerBlocked && outerBlockedHint && (
              <span className="text-xs text-muted-foreground/70 pl-1">{outerBlockedHint}</span>
            )}
            {!outerBlocked && commentBlocked && (
              <span className="text-xs text-muted-foreground/70 pl-1">Comment required</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Verdict experience styled like GitHub PR review. Renders N buttons from
 * `verdicts` (resolved server-side from the WD step), one per allowed key.
 * When `verdicts` is absent (older tasks created before the field existed),
 * falls back to the legacy approve/revise UI.
 */
export function VerdictForm({
  taskId,
  disabled,
  remainingTaskCount,
  verdicts,
  onCompleted,
}: VerdictFormProps) {
  const resolved = verdicts && verdicts.length > 0 ? verdicts : LEGACY_VERDICTS;
  const [comment, setComment] = React.useState('');
  const [submitting, setSubmitting] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(false);
  const [submittedData, setSubmittedData] = React.useState<SubmittedData | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const trimmedComment = comment.trim();

  async function handleSubmit(cfg: TaskVerdict) {
    if (cfg.requiresComment && !trimmedComment) return;
    if (submitting) return;

    setSubmitting(cfg.key);
    setError(null);

    try {
      await mediforce.tasks.complete({
        taskId,
        payload: { kind: 'verdict', verdict: cfg.key, comment: trimmedComment },
      });
      setSubmittedData({
        verdict: cfg.key,
        intent: cfg.intent,
        label: cfg.label,
        comment: trimmedComment,
        timestamp: new Date().toISOString(),
      });
      setSubmitted(true);
      onCompleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit verdict');
      setSubmitting(null);
    }
  }

  if (submitted && submittedData) {
    return <VerdictConfirmation data={submittedData} remainingTaskCount={remainingTaskCount} />;
  }

  return (
    <div className="space-y-3">
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Add a comment (optional)..."
        rows={3}
        disabled={disabled || submitting !== null}
        aria-label="Review comment"
        className={cn(
          'w-full rounded-md border bg-background px-3 py-2 text-sm',
          'placeholder:text-muted-foreground',
          'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary',
          'resize-y min-h-[72px]',
          (disabled || submitting !== null) && 'opacity-50 cursor-not-allowed',
        )}
      />

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <VerdictButtons
        verdicts={resolved}
        submitting={submitting}
        trimmedComment={trimmedComment}
        outerBlocked={disabled}
        onVerdict={handleSubmit}
      />

      {disabled && (
        <p className="text-xs text-muted-foreground">
          Review the step output before submitting a verdict.
        </p>
      )}
    </div>
  );
}

function IntentIcon({ intent, className }: { intent: Intent; className?: string }) {
  const { Icon } = INTENT_STYLES[intent];
  return <Icon className={className} />;
}

export function VerdictConfirmation({
  data,
  remainingTaskCount,
  params,
  paramValues,
}: {
  data: SubmittedData;
  remainingTaskCount?: number;
  params?: StepParam[];
  paramValues?: Record<string, unknown>;
}) {
  const styles = INTENT_STYLES[data.intent];

  return (
    <div className="space-y-4">
      <div className={cn('rounded-lg border p-4', styles.card)}>
        <div className="flex items-center gap-2">
          <IntentIcon intent={data.intent} className={cn('h-5 w-5', styles.iconColor)} />
          <span className={cn('font-medium text-sm', styles.text)}>
            Submitted: {data.label}
          </span>
        </div>

        {params && params.length > 0 && paramValues && (
          <dl className="space-y-1 mt-2">
            {params.map((p) => {
              const val = paramValues[p.name];
              if (val === undefined || val === '') return null;
              return (
                <div key={p.name}>
                  <dt className={cn('text-xs font-medium opacity-70', styles.text)}>{p.name}</dt>
                  <dd className={cn('text-sm whitespace-pre-wrap', styles.text)}>{String(val)}</dd>
                </div>
              );
            })}
          </dl>
        )}

        {data.comment && (
          <blockquote className={cn('mt-3 border-l-2 pl-3 text-sm', styles.blockquote)}>
            {data.comment}
          </blockquote>
        )}

        <p className={cn('mt-2 text-xs', styles.timestamp)}>
          {format(new Date(data.timestamp), 'MMM d, yyyy HH:mm')}
        </p>
      </div>

      <RemainingTasksFooter remainingTaskCount={remainingTaskCount} />
    </div>
  );
}

/**
 * Read-only verdict confirmation for already completed tasks. Reconstructs
 * the post-submission view from task.completionData + the task's verdict
 * descriptors (when available — older tasks fall back to legacy intent
 * mapping). Pass `params` to also render submitted param values (for the
 * verdict-with-params kind).
 */
export function VerdictConfirmationReadOnly({
  completionData,
  verdicts,
  remainingTaskCount,
  params,
}: {
  completionData: Record<string, unknown>;
  verdicts?: TaskVerdict[];
  remainingTaskCount?: number;
  params?: StepParam[];
}) {
  const verdict = completionData.verdict as string | undefined;
  const comment = (completionData.comment as string) ?? '';
  const timestamp = (completionData.completedAt as string) ?? '';
  const paramValues = completionData.paramValues as Record<string, unknown> | undefined;

  if (!verdict) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        Task completed. No verdict data available.
      </div>
    );
  }

  const cfg = verdicts?.find((v) => v.key === verdict)
    ?? LEGACY_VERDICTS.find((v) => v.key === verdict)
    ?? { key: verdict, label: verdict, intent: 'neutral' as Intent, requiresComment: false };

  return (
    <VerdictConfirmation
      data={{ verdict, intent: cfg.intent, label: cfg.label, comment, timestamp }}
      remainingTaskCount={remainingTaskCount}
      params={params}
      paramValues={paramValues}
    />
  );
}
