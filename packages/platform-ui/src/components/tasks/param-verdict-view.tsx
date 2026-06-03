'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { Loader2, CheckCircle, XCircle, AlertCircle, MinusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mediforce, ApiError } from '@/lib/mediforce';
import { ParamField } from '@/components/ui/param-field';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import type { TaskVerdict, StepParam } from '@mediforce/platform-core';
import type { TaskBodyProps } from './task-body-registry';

type Intent = 'success' | 'warning' | 'danger' | 'neutral';

const INTENT_STYLES: Record<Intent, {
  submit: string;
  Icon: typeof CheckCircle;
  card: string;
  iconColor: string;
  text: string;
  blockquote: string;
  timestamp: string;
}> = {
  success: {
    submit: 'bg-green-600 text-white hover:bg-green-700',
    Icon: CheckCircle,
    card: 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800',
    iconColor: 'text-green-600 dark:text-green-400',
    text: 'text-green-800 dark:text-green-300',
    blockquote: 'border-green-300 text-green-700 dark:border-green-700 dark:text-green-300',
    timestamp: 'text-green-600/70 dark:text-green-400/70',
  },
  warning: {
    submit: 'bg-yellow-600 text-white hover:bg-yellow-700',
    Icon: AlertCircle,
    card: 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800',
    iconColor: 'text-amber-600 dark:text-amber-400',
    text: 'text-amber-800 dark:text-amber-300',
    blockquote: 'border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300',
    timestamp: 'text-amber-600/70 dark:text-amber-400/70',
  },
  danger: {
    submit: 'bg-red-600 text-white hover:bg-red-700',
    Icon: XCircle,
    card: 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800',
    iconColor: 'text-red-600 dark:text-red-400',
    text: 'text-red-800 dark:text-red-300',
    blockquote: 'border-red-300 text-red-700 dark:border-red-700 dark:text-red-300',
    timestamp: 'text-red-600/70 dark:text-red-400/70',
  },
  neutral: {
    submit: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    Icon: MinusCircle,
    card: 'bg-slate-50 border-slate-200 dark:bg-slate-900/20 dark:border-slate-800',
    iconColor: 'text-slate-600 dark:text-slate-400',
    text: 'text-slate-800 dark:text-slate-300',
    blockquote: 'border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-300',
    timestamp: 'text-slate-600/70 dark:text-slate-400/70',
  },
};

export function ParamVerdictView({ task, remainingTaskCount }: TaskBodyProps) {
  const isActionable = task.status === 'claimed' || task.status === 'pending';
  const isCompleted  = task.status === 'completed';

  if (isActionable) {
    return (
      <ParamVerdictForm
        taskId={task.id}
        params={task.params ?? []}
        verdicts={task.verdicts ?? []}
        remainingTaskCount={remainingTaskCount}
      />
    );
  }
  if (isCompleted && task.completionData) {
    return (
      <CompletionReadOnly
        completionData={task.completionData}
        params={task.params ?? []}
        verdicts={task.verdicts}
        remainingTaskCount={remainingTaskCount}
      />
    );
  }
  return null;
}

function ParamVerdictForm({
  taskId,
  params,
  verdicts,
  remainingTaskCount,
}: {
  taskId: string;
  params: StepParam[];
  verdicts: TaskVerdict[];
  remainingTaskCount?: number;
}) {
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [comment, setComment] = React.useState('');
  const [submitting, setSubmitting] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function setValue(name: string, value: unknown) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  const requiredMissing = params.some(
    (p) => p.required && (values[p.name] === undefined || values[p.name] === ''),
  );

  const trimmedComment = comment.trim();

  async function handleVerdict(cfg: TaskVerdict) {
    if (requiredMissing) return;
    if (cfg.requiresComment && !trimmedComment) return;
    if (submitting) return;

    setSubmitting(cfg.key);
    setError(null);

    try {
      await mediforce.tasks.complete({
        taskId,
        payload: {
          kind: 'verdict-with-params',
          verdict: cfg.key,
          comment: trimmedComment || undefined,
          paramValues: values,
        },
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit');
      setSubmitting(null);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:bg-green-900/20 dark:border-green-800">
        <div className="flex items-center gap-2">
          <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
          <span className="font-medium text-sm text-green-800 dark:text-green-300">
            Submitted successfully
            {remainingTaskCount !== undefined && remainingTaskCount > 0
              ? ` — ${remainingTaskCount} task${remainingTaskCount > 1 ? 's' : ''} remaining`
              : ''}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4 space-y-4">
        {params.map((param) => (
          <ParamField
            key={param.name}
            param={param}
            value={values[param.name]}
            onChange={(value) => setValue(param.name, value)}
            disabled={submitting !== null}
          />
        ))}
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Add a comment (optional, required for some choices)..."
        rows={2}
        disabled={submitting !== null}
        className={cn(
          'w-full rounded-md border bg-background px-3 py-2 text-sm',
          'placeholder:text-muted-foreground resize-y min-h-[56px]',
          'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary',
          submitting !== null && 'opacity-50 cursor-not-allowed',
        )}
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap items-start gap-3">
        {verdicts.map((cfg) => {
          const styles = INTENT_STYLES[cfg.intent];
          const blocked = requiredMissing || (cfg.requiresComment && !trimmedComment);
          const isSubmittingThis = submitting === cfg.key;
          const isDisabled = submitting !== null || blocked;
          return (
            <div key={cfg.key} className="flex flex-col items-start gap-1">
              <button
                type="button"
                onClick={() => handleVerdict(cfg)}
                disabled={isDisabled}
                className={cn(
                  'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
                  styles.submit,
                  isDisabled && 'opacity-50 cursor-not-allowed',
                )}
              >
                {isSubmittingThis
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <styles.Icon className="h-4 w-4" />}
                {cfg.label}
              </button>
              {requiredMissing && (
                <span className="text-xs text-muted-foreground/70 pl-1">Fill required fields first</span>
              )}
              {!requiredMissing && cfg.requiresComment && !trimmedComment && (
                <span className="text-xs text-muted-foreground/70 pl-1">Comment required</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompletionReadOnly({
  completionData,
  params,
  verdicts,
  remainingTaskCount,
}: {
  completionData: unknown;
  params: StepParam[];
  verdicts?: TaskVerdict[];
  remainingTaskCount?: number;
}) {
  const handle = useHandleFromPath();
  const data = completionData as Record<string, unknown>;
  const verdictKey = data.verdict as string | undefined;
  const comment = data.comment as string | undefined;
  const timestamp = data.completedAt as string | undefined;
  const paramValues = data.paramValues as Record<string, unknown> | undefined;

  const cfg = verdicts?.find((v) => v.key === verdictKey)
    ?? { key: verdictKey ?? '', label: verdictKey ?? '', intent: 'neutral' as Intent, requiresComment: false };
  const styles = INTENT_STYLES[cfg.intent];
  const { Icon } = styles;

  return (
    <div className="space-y-4">
      <div className={cn('rounded-lg border p-4 space-y-2', styles.card)}>
        <div className="flex items-center gap-2">
          <Icon className={cn('h-5 w-5', styles.iconColor)} />
          <span className={cn('font-medium text-sm', styles.text)}>
            Submitted: {cfg.label}
          </span>
        </div>

        {paramValues && params.length > 0 && (
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

        {comment && (
          <blockquote className={cn('border-l-2 pl-3 text-sm', styles.blockquote)}>
            {comment}
          </blockquote>
        )}

        {timestamp && (
          <p className={cn('text-xs', styles.timestamp)}>
            {format(new Date(timestamp), 'MMM d, yyyy HH:mm')}
          </p>
        )}
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
