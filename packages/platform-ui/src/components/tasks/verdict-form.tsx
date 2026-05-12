'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { CheckCircle, MessageSquare, Loader2, XCircle, Circle } from 'lucide-react';
import type { TaskVerdict } from '@mediforce/platform-core';
import { completeTask } from '@/app/actions/tasks';
import { useAuth } from '@/contexts/auth-context';
import { cn } from '@/lib/utils';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';

type Intent = 'success' | 'danger' | 'warning' | 'neutral';

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
  const { firebaseUser } = useAuth();
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

    const idToken = firebaseUser ? await firebaseUser.getIdToken() : '';
    const result = await completeTask(taskId, cfg.key, trimmedComment, undefined, idToken);

    if (result.success) {
      setSubmittedData({
        verdict: cfg.key,
        intent: cfg.intent,
        label: cfg.label,
        comment: trimmedComment,
        timestamp: new Date().toISOString(),
      });
      setSubmitted(true);
      onCompleted?.();
    } else {
      setError(result.error ?? 'Failed to submit verdict');
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

type IntentStyles = {
  Icon: typeof CheckCircle;
  submit: string;
  card: string;
  iconColor: string;
  text: string;
  blockquote: string;
  timestamp: string;
};

const INTENT_STYLES: Record<Intent, IntentStyles> = {
  success: {
    Icon: CheckCircle,
    submit: 'bg-green-600 text-white hover:bg-green-700',
    card: 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800',
    iconColor: 'text-green-600 dark:text-green-400',
    text: 'text-green-800 dark:text-green-300',
    blockquote: 'border-green-300 text-green-700 dark:border-green-700 dark:text-green-300',
    timestamp: 'text-green-600/70 dark:text-green-400/70',
  },
  danger: {
    Icon: XCircle,
    submit: 'bg-red-600 text-white hover:bg-red-700',
    card: 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800',
    iconColor: 'text-red-600 dark:text-red-400',
    text: 'text-red-800 dark:text-red-300',
    blockquote: 'border-red-300 text-red-700 dark:border-red-700 dark:text-red-300',
    timestamp: 'text-red-600/70 dark:text-red-400/70',
  },
  warning: {
    Icon: MessageSquare,
    submit: 'bg-amber-600 text-white hover:bg-amber-700',
    card: 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800',
    iconColor: 'text-amber-600 dark:text-amber-400',
    text: 'text-amber-800 dark:text-amber-300',
    blockquote: 'border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300',
    timestamp: 'text-amber-600/70 dark:text-amber-400/70',
  },
  neutral: {
    Icon: Circle,
    submit: 'bg-slate-600 text-white hover:bg-slate-700',
    card: 'bg-slate-50 border-slate-200 dark:bg-slate-900/20 dark:border-slate-800',
    iconColor: 'text-slate-600 dark:text-slate-400',
    text: 'text-slate-800 dark:text-slate-300',
    blockquote: 'border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-300',
    timestamp: 'text-slate-600/70 dark:text-slate-400/70',
  },
};

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
