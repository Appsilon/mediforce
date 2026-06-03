'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import type { TaskVerdict } from '@mediforce/platform-core';
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

      <div className="flex flex-wrap items-start gap-3">
        {resolved.map((cfg) => {
          const blocked = cfg.requiresComment && !trimmedComment;
          const isSubmittingThis = submitting === cfg.key;
          const isDisabled = disabled || submitting !== null || blocked;
          return (
            <div key={cfg.key} className="flex flex-col items-start gap-1">
              <button
                type="button"
                onClick={() => handleSubmit(cfg)}
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
              {blocked && (
                <span className="text-xs text-muted-foreground/70 pl-1">Comment required</span>
              )}
            </div>
          );
        })}
      </div>

      {disabled && (
        <p className="text-xs text-muted-foreground">
          Review the step output before submitting a verdict.
        </p>
      )}
    </div>
  );
}

// --- Intent helpers ------------------------------------------------------

function IntentIcon({ intent, className }: { intent: Intent; className?: string }) {
  const { Icon } = INTENT_STYLES[intent];
  return <Icon className={className} />;
}

// --- Post-submission inline confirmation ---------------------------------

function VerdictConfirmation({
  data,
  remainingTaskCount,
}: {
  data: SubmittedData;
  remainingTaskCount?: number;
}) {
  const handle = useHandleFromPath();
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

        {data.comment && (
          <blockquote className={cn('mt-3 border-l-2 pl-3 text-sm', styles.blockquote)}>
            {data.comment}
          </blockquote>
        )}

        <p className={cn('mt-2 text-xs', styles.timestamp)}>
          {format(new Date(data.timestamp), 'MMM d, yyyy HH:mm')}
        </p>
      </div>

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
    </div>
  );
}

/**
 * Read-only verdict confirmation for already completed tasks. Reconstructs
 * the post-submission view from task.completionData + the task's verdict
 * descriptors (when available — older tasks fall back to legacy intent
 * mapping).
 */
export function VerdictConfirmationReadOnly({
  completionData,
  verdicts,
  remainingTaskCount,
}: {
  completionData: Record<string, unknown>;
  verdicts?: TaskVerdict[];
  remainingTaskCount?: number;
}) {
  const verdict = completionData.verdict as string | undefined;
  const comment = (completionData.comment as string) ?? '';
  const timestamp = (completionData.completedAt as string) ?? '';

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
    />
  );
}
