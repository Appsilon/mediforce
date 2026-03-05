'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { CheckCircle, MessageSquare, X, Loader2 } from 'lucide-react';
import { completeTask } from '@/app/actions/tasks';
import { cn } from '@/lib/utils';

interface VerdictFormProps {
  taskId: string;
  disabled: boolean; // True when no content to review
  remainingTaskCount?: number;
  onCompleted?: () => void;
}

interface SubmittedData {
  verdict: 'approve' | 'revise';
  comment: string;
  timestamp: string;
}

/**
 * Approve/Revise verdict experience styled like GitHub PR review.
 *
 * Pre-submission: Two buttons (Approve, Revise) with optional/mandatory comment.
 * Post-submission: Inline confirmation card with verdict, comment, and timestamp.
 */
export function VerdictForm({
  taskId,
  disabled,
  remainingTaskCount,
  onCompleted,
}: VerdictFormProps) {
  const [verdict, setVerdict] = React.useState<'approve' | 'revise' | null>(null);
  const [comment, setComment] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [submittedData, setSubmittedData] = React.useState<SubmittedData | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit() {
    if (!verdict) return;
    if (verdict === 'revise' && !comment.trim()) return;

    setSubmitting(true);
    setError(null);

    const result = await completeTask(taskId, verdict, comment.trim());

    if (result.success) {
      const data: SubmittedData = {
        verdict,
        comment: comment.trim(),
        timestamp: new Date().toISOString(),
      };
      setSubmittedData(data);
      setSubmitted(true);
      onCompleted?.();
    } else {
      setError(result.error ?? 'Failed to submit verdict');
    }

    setSubmitting(false);
  }

  // --- Post-submission state ---
  if (submitted && submittedData) {
    return <VerdictConfirmation data={submittedData} remainingTaskCount={remainingTaskCount} />;
  }

  // --- Pre-submission state ---
  return (
    <div className="space-y-4">
      {/* Verdict buttons */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => { setVerdict('approve'); setError(null); }}
          disabled={disabled || submitting}
          className={cn(
            'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
            verdict === 'approve'
              ? 'bg-green-600 text-white ring-2 ring-green-600/30'
              : 'bg-green-600 text-white hover:bg-green-700',
            (disabled || submitting) && 'opacity-50 cursor-not-allowed',
          )}
        >
          <CheckCircle className="h-4 w-4" />
          Approve
        </button>

        <button
          onClick={() => { setVerdict('revise'); setError(null); }}
          disabled={disabled || submitting}
          className={cn(
            'inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors',
            verdict === 'revise'
              ? 'border-amber-500 text-amber-700 bg-amber-50 ring-2 ring-amber-500/30 dark:bg-amber-900/20 dark:text-amber-300'
              : 'border-amber-500 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-900/20',
            (disabled || submitting) && 'opacity-50 cursor-not-allowed',
          )}
        >
          <MessageSquare className="h-4 w-4" />
          Revise
        </button>
      </div>

      {/* Disabled hint */}
      {disabled && (
        <p className="text-xs text-muted-foreground">
          Review the step output before submitting a verdict.
        </p>
      )}

      {/* Comment area + submit when verdict is selected */}
      {verdict && !disabled && (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {verdict === 'approve' ? 'Approve with comment' : 'Request revisions'}
            </span>
            <button
              onClick={() => { setVerdict(null); setComment(''); setError(null); }}
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
              verdict === 'approve'
                ? 'Optional: add a comment...'
                : 'Describe what needs to change...'
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
              disabled={submitting || (verdict === 'revise' && !comment.trim())}
              className={cn(
                'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
                verdict === 'approve'
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-amber-600 text-white hover:bg-amber-700',
                (submitting || (verdict === 'revise' && !comment.trim())) && 'opacity-50 cursor-not-allowed',
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

// --- Post-submission inline confirmation ---

function VerdictConfirmation({
  data,
  remainingTaskCount,
}: {
  data: SubmittedData;
  remainingTaskCount?: number;
}) {
  const isApprove = data.verdict === 'approve';

  return (
    <div className="space-y-4">
      {/* Confirmation card */}
      <div
        className={cn(
          'rounded-lg border p-4',
          isApprove
            ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
            : 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800',
        )}
      >
        <div className="flex items-center gap-2">
          {isApprove ? (
            <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
          ) : (
            <MessageSquare className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          )}
          <span
            className={cn(
              'font-medium text-sm',
              isApprove
                ? 'text-green-800 dark:text-green-300'
                : 'text-amber-800 dark:text-amber-300',
            )}
          >
            {isApprove ? 'You approved this review' : 'You requested revisions'}
          </span>
        </div>

        {data.comment && (
          <blockquote
            className={cn(
              'mt-3 border-l-2 pl-3 text-sm',
              isApprove
                ? 'border-green-300 text-green-700 dark:border-green-700 dark:text-green-300'
                : 'border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300',
            )}
          >
            {data.comment}
          </blockquote>
        )}

        <p
          className={cn(
            'mt-2 text-xs',
            isApprove
              ? 'text-green-600/70 dark:text-green-400/70'
              : 'text-amber-600/70 dark:text-amber-400/70',
          )}
        >
          {format(new Date(data.timestamp), 'MMM d, yyyy HH:mm')}
        </p>
      </div>

      {/* Remaining tasks prompt */}
      <div className="text-sm text-muted-foreground">
        {remainingTaskCount !== undefined && remainingTaskCount > 0 ? (
          <span>
            You have {remainingTaskCount} more {remainingTaskCount === 1 ? 'task' : 'tasks'} &mdash;{' '}
            <Link href="/tasks" className="text-primary hover:underline font-medium">
              View next task
            </Link>
          </span>
        ) : (
          <Link href="/tasks" className="text-primary hover:underline font-medium">
            Back to tasks
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * Read-only verdict confirmation for already completed tasks.
 * Reconstructs the post-submission view from task.completionData.
 */
export function VerdictConfirmationReadOnly({
  completionData,
  remainingTaskCount,
}: {
  completionData: Record<string, unknown>;
  remainingTaskCount?: number;
}) {
  const verdict = completionData.verdict as 'approve' | 'revise' | undefined;
  const comment = (completionData.comment as string) ?? '';
  const timestamp = (completionData.completedAt as string) ?? '';

  if (!verdict) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        Task completed. No verdict data available.
      </div>
    );
  }

  return (
    <VerdictConfirmation
      data={{ verdict, comment, timestamp }}
      remainingTaskCount={remainingTaskCount}
    />
  );
}
