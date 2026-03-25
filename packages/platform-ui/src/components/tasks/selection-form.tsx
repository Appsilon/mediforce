'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { CheckCircle, MessageSquare, X, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { completeTask } from '@/app/actions/tasks';
import { cn } from '@/lib/utils';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';

interface SelectionFormProps {
  taskId: string;
  options: Record<string, unknown>[];
  remainingTaskCount?: number;
  onCompleted?: () => void;
}

interface SubmittedData {
  verdict: 'approve' | 'revise';
  selectedIndex?: number;
  selectedLabel?: string;
  comment: string;
  timestamp: string;
}

export function SelectionForm({
  taskId,
  options,
  remainingTaskCount,
  onCompleted,
}: SelectionFormProps) {
  const handle = useHandleFromPath();
  const [selectedIndex, setSelectedIndex] = React.useState<number | null>(null);
  const [mode, setMode] = React.useState<'select' | 'revise' | null>(null);
  const [comment, setComment] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState<SubmittedData | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function handleApprove() {
    if (selectedIndex === null) return;
    setSubmitting(true);
    setError(null);

    const result = await completeTask(taskId, 'approve', '', selectedIndex);

    if (result.success) {
      const selected = options[selectedIndex];
      setSubmitted({
        verdict: 'approve',
        selectedIndex,
        selectedLabel: (selected.label as string) ?? `Option ${selectedIndex + 1}`,
        comment: '',
        timestamp: new Date().toISOString(),
      });
      onCompleted?.();
    } else {
      setError(result.error ?? 'Failed to submit');
    }
    setSubmitting(false);
  }

  async function handleRevise() {
    if (!comment.trim()) return;
    setSubmitting(true);
    setError(null);

    const result = await completeTask(taskId, 'revise', comment.trim());

    if (result.success) {
      setSubmitted({
        verdict: 'revise',
        comment: comment.trim(),
        timestamp: new Date().toISOString(),
      });
      onCompleted?.();
    } else {
      setError(result.error ?? 'Failed to submit');
    }
    setSubmitting(false);
  }

  if (submitted) {
    return <SelectionConfirmation data={submitted} remainingTaskCount={remainingTaskCount} />;
  }

  return (
    <div className="space-y-4">
      <div className="text-sm font-medium text-muted-foreground">
        Select one option to approve, or request revisions
      </div>

      {/* Option cards */}
      <div className="grid gap-3">
        {options.map((option, index) => (
          <OptionCard
            key={index}
            option={option}
            index={index}
            selected={selectedIndex === index}
            disabled={submitting}
            onSelect={() => {
              setSelectedIndex(index);
              setMode('select');
              setError(null);
            }}
          />
        ))}
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleApprove}
          disabled={selectedIndex === null || submitting}
          className={cn(
            'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
            'bg-green-600 text-white hover:bg-green-700',
            (selectedIndex === null || submitting) && 'opacity-50 cursor-not-allowed',
          )}
        >
          {submitting && mode === 'select' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle className="h-4 w-4" />
          )}
          Approve selected
        </button>

        <button
          onClick={() => {
            setMode(mode === 'revise' ? null : 'revise');
            setError(null);
          }}
          disabled={submitting}
          className={cn(
            'inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors',
            mode === 'revise'
              ? 'border-amber-500 text-amber-700 bg-amber-50 ring-2 ring-amber-500/30 dark:bg-amber-900/20 dark:text-amber-300'
              : 'border-amber-500 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-900/20',
            submitting && 'opacity-50 cursor-not-allowed',
          )}
        >
          <MessageSquare className="h-4 w-4" />
          Request revisions
        </button>
      </div>

      {/* Revise comment area */}
      {mode === 'revise' && (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Request revisions</span>
            <button
              onClick={() => { setMode(null); setComment(''); setError(null); }}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
              Cancel
            </button>
          </div>

          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Describe what needs to change..."
            rows={3}
            className={cn(
              'w-full rounded-md border bg-background px-3 py-2 text-sm',
              'placeholder:text-muted-foreground',
              'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary',
              'resize-y min-h-[72px]',
            )}
          />

          <button
            onClick={handleRevise}
            disabled={submitting || !comment.trim()}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
              'bg-amber-600 text-white hover:bg-amber-700',
              (submitting || !comment.trim()) && 'opacity-50 cursor-not-allowed',
            )}
          >
            {submitting && mode === 'revise' && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? 'Submitting...' : 'Submit revision request'}
          </button>
        </div>
      )}
    </div>
  );
}

// --- Option card ---

function OptionCard({
  option,
  index,
  selected,
  disabled,
  onSelect,
}: {
  option: Record<string, unknown>;
  index: number;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const label = (option.label as string) ?? `Option ${index + 1}`;
  const description = option.description as string | undefined;
  const value = option.value as Record<string, unknown> | undefined;

  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={disabled ? -1 : 0}
      onClick={() => { if (!disabled) onSelect(); }}
      onKeyDown={(event) => { if (!disabled && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(); } }}
      className={cn(
        'w-full text-left rounded-lg border p-4 transition-colors cursor-pointer',
        selected
          ? 'border-green-500 bg-green-50 ring-2 ring-green-500/30 dark:bg-green-900/20 dark:border-green-600'
          : 'border-border hover:border-primary/40 hover:bg-muted/50',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center',
            selected
              ? 'border-green-600 bg-green-600'
              : 'border-muted-foreground/40',
          )}
        >
          {selected && (
            <div className="h-2 w-2 rounded-full bg-white" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{label}</div>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}

          {value && (
            <div className="mt-2">
              <button
                type="button"
                onClick={(event) => { event.stopPropagation(); setExpanded(!expanded); }}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {expanded ? 'Hide details' : 'Show details'}
              </button>
              {expanded && (
                <pre className="mt-2 rounded-md bg-muted p-3 text-xs overflow-x-auto max-h-64 overflow-y-auto">
                  {JSON.stringify(value, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Post-submission confirmation ---

function SelectionConfirmation({
  data,
  remainingTaskCount,
}: {
  data: SubmittedData;
  remainingTaskCount?: number;
}) {
  const handle = useHandleFromPath();
  const isApprove = data.verdict === 'approve';

  return (
    <div className="space-y-4">
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
            {isApprove
              ? `You approved: ${data.selectedLabel}`
              : 'You requested revisions'}
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
 * Read-only selection confirmation for already completed tasks.
 */
export function SelectionConfirmationReadOnly({
  completionData,
  remainingTaskCount,
}: {
  completionData: Record<string, unknown>;
  remainingTaskCount?: number;
}) {
  const verdict = completionData.verdict as 'approve' | 'revise' | undefined;
  const selectedOption = completionData.selectedOption as Record<string, unknown> | undefined;
  const selectedIdx = completionData.selectedIndex as number | undefined;
  const comment = (completionData.comment as string) ?? '';
  const timestamp = (completionData.completedAt as string) ?? '';

  if (!verdict) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        Task completed. No verdict data available.
      </div>
    );
  }

  const label = selectedOption
    ? (selectedOption.label as string) ?? `Option ${(selectedIdx ?? 0) + 1}`
    : undefined;

  return (
    <SelectionConfirmation
      data={{ verdict, selectedIndex: selectedIdx, selectedLabel: label, comment, timestamp }}
      remainingTaskCount={remainingTaskCount}
    />
  );
}
