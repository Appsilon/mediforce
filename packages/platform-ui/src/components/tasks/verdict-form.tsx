'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { CheckCircle, MessageSquare, X, Loader2, XCircle, Circle } from 'lucide-react';
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
  /** Resolved verdict descriptors copied from the WD step. When absent, the
   *  form falls back to the legacy approve/revise UI for older tasks. */
  verdicts?: Record<string, TaskVerdict>;
  onCompleted?: () => void;
}

interface SubmittedData {
  verdict: string;
  intent: Intent;
  label: string;
  comment: string;
  timestamp: string;
}

const LEGACY_VERDICTS: Record<string, TaskVerdict> = {
  approve: { label: 'Approve', intent: 'success', requiresComment: false },
  revise: { label: 'Request revisions', intent: 'warning', requiresComment: true },
};

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
  const resolved = verdicts ?? LEGACY_VERDICTS;
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const [comment, setComment] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [submittedData, setSubmittedData] = React.useState<SubmittedData | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const selectedCfg = selectedKey ? resolved[selectedKey] : null;
  const commentMissing = !!selectedCfg?.requiresComment && !comment.trim();

  async function handleSubmit() {
    if (!selectedKey || !selectedCfg) return;
    if (commentMissing) return;

    setSubmitting(true);
    setError(null);

    const idToken = firebaseUser ? await firebaseUser.getIdToken() : '';
    const result = await completeTask(taskId, selectedKey, comment.trim(), undefined, idToken);

    if (result.success) {
      setSubmittedData({
        verdict: selectedKey,
        intent: selectedCfg.intent,
        label: selectedCfg.label,
        comment: comment.trim(),
        timestamp: new Date().toISOString(),
      });
      setSubmitted(true);
      onCompleted?.();
    } else {
      setError(result.error ?? 'Failed to submit verdict');
    }

    setSubmitting(false);
  }

  if (submitted && submittedData) {
    return <VerdictConfirmation data={submittedData} remainingTaskCount={remainingTaskCount} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {Object.entries(resolved).map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => { setSelectedKey(key); setError(null); }}
            disabled={disabled || submitting}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
              intentButtonClasses(cfg.intent, selectedKey === key),
              (disabled || submitting) && 'opacity-50 cursor-not-allowed',
            )}
          >
            <IntentIcon intent={cfg.intent} className="h-4 w-4" />
            {cfg.label}
          </button>
        ))}
      </div>

      {disabled && (
        <p className="text-xs text-muted-foreground">
          Review the step output before submitting a verdict.
        </p>
      )}

      {selectedKey && selectedCfg && !disabled && (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{selectedCfg.label}</span>
            <button
              onClick={() => { setSelectedKey(null); setComment(''); setError(null); }}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
              Cancel
            </button>
          </div>

          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={
              selectedCfg.requiresComment
                ? 'Describe the reason — required'
                : 'Optional: add a comment...'
            }
            rows={3}
            className={cn(
              'w-full rounded-md border bg-background px-3 py-2 text-sm',
              'placeholder:text-muted-foreground',
              'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary',
              'resize-y min-h-[72px]',
            )}
          />

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleSubmit}
              disabled={submitting || commentMissing}
              className={cn(
                'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
                intentSubmitClasses(selectedCfg.intent),
                (submitting || commentMissing) && 'opacity-50 cursor-not-allowed',
              )}
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? 'Submitting...' : 'Submit review'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Intent helpers ------------------------------------------------------

function IntentIcon({ intent, className }: { intent: Intent; className?: string }) {
  switch (intent) {
    case 'success':
      return <CheckCircle className={className} />;
    case 'danger':
      return <XCircle className={className} />;
    case 'warning':
      return <MessageSquare className={className} />;
    case 'neutral':
    default:
      return <Circle className={className} />;
  }
}

function intentButtonClasses(intent: Intent, selected: boolean): string {
  switch (intent) {
    case 'success':
      return selected
        ? 'bg-green-600 text-white ring-2 ring-green-600/30'
        : 'bg-green-600 text-white hover:bg-green-700';
    case 'danger':
      return selected
        ? 'bg-red-600 text-white ring-2 ring-red-600/30'
        : 'bg-red-600 text-white hover:bg-red-700';
    case 'warning':
      return selected
        ? 'border border-amber-500 text-amber-700 bg-amber-50 ring-2 ring-amber-500/30 dark:bg-amber-900/20 dark:text-amber-300'
        : 'border border-amber-500 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-900/20';
    case 'neutral':
    default:
      return selected
        ? 'border border-slate-500 text-slate-700 bg-slate-50 ring-2 ring-slate-500/30 dark:bg-slate-800/40 dark:text-slate-200'
        : 'border border-slate-500 text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/40';
  }
}

function intentSubmitClasses(intent: Intent): string {
  switch (intent) {
    case 'success':
      return 'bg-green-600 text-white hover:bg-green-700';
    case 'danger':
      return 'bg-red-600 text-white hover:bg-red-700';
    case 'warning':
      return 'bg-amber-600 text-white hover:bg-amber-700';
    case 'neutral':
    default:
      return 'bg-slate-600 text-white hover:bg-slate-700';
  }
}

function intentCardClasses(intent: Intent): string {
  switch (intent) {
    case 'success':
      return 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800';
    case 'danger':
      return 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800';
    case 'warning':
      return 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800';
    case 'neutral':
    default:
      return 'bg-slate-50 border-slate-200 dark:bg-slate-900/20 dark:border-slate-800';
  }
}

function intentIconColorClasses(intent: Intent): string {
  switch (intent) {
    case 'success':
      return 'text-green-600 dark:text-green-400';
    case 'danger':
      return 'text-red-600 dark:text-red-400';
    case 'warning':
      return 'text-amber-600 dark:text-amber-400';
    case 'neutral':
    default:
      return 'text-slate-600 dark:text-slate-400';
  }
}

function intentTextClasses(intent: Intent): string {
  switch (intent) {
    case 'success':
      return 'text-green-800 dark:text-green-300';
    case 'danger':
      return 'text-red-800 dark:text-red-300';
    case 'warning':
      return 'text-amber-800 dark:text-amber-300';
    case 'neutral':
    default:
      return 'text-slate-800 dark:text-slate-300';
  }
}

function intentBlockquoteClasses(intent: Intent): string {
  switch (intent) {
    case 'success':
      return 'border-green-300 text-green-700 dark:border-green-700 dark:text-green-300';
    case 'danger':
      return 'border-red-300 text-red-700 dark:border-red-700 dark:text-red-300';
    case 'warning':
      return 'border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300';
    case 'neutral':
    default:
      return 'border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-300';
  }
}

function intentTimestampClasses(intent: Intent): string {
  switch (intent) {
    case 'success':
      return 'text-green-600/70 dark:text-green-400/70';
    case 'danger':
      return 'text-red-600/70 dark:text-red-400/70';
    case 'warning':
      return 'text-amber-600/70 dark:text-amber-400/70';
    case 'neutral':
    default:
      return 'text-slate-600/70 dark:text-slate-400/70';
  }
}

function confirmationHeadline(verdict: string, label: string): string {
  if (verdict === 'approve') return 'You approved this review';
  if (verdict === 'revise') return 'You requested revisions';
  return `Submitted: ${label}`;
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

  return (
    <div className="space-y-4">
      <div className={cn('rounded-lg border p-4', intentCardClasses(data.intent))}>
        <div className="flex items-center gap-2">
          <IntentIcon intent={data.intent} className={cn('h-5 w-5', intentIconColorClasses(data.intent))} />
          <span className={cn('font-medium text-sm', intentTextClasses(data.intent))}>
            {confirmationHeadline(data.verdict, data.label)}
          </span>
        </div>

        {data.comment && (
          <blockquote className={cn('mt-3 border-l-2 pl-3 text-sm', intentBlockquoteClasses(data.intent))}>
            {data.comment}
          </blockquote>
        )}

        <p className={cn('mt-2 text-xs', intentTimestampClasses(data.intent))}>
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
  verdicts?: Record<string, TaskVerdict>;
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

  const cfg = verdicts?.[verdict] ?? LEGACY_VERDICTS[verdict] ?? {
    label: verdict,
    intent: 'neutral' as Intent,
    requiresComment: false,
  };

  return (
    <VerdictConfirmation
      data={{ verdict, intent: cfg.intent, label: cfg.label, comment, timestamp }}
      remainingTaskCount={remainingTaskCount}
    />
  );
}
