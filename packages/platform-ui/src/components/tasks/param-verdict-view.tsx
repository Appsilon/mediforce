'use client';

import * as React from 'react';
import { Loader2, Send, CheckCircle, XCircle, AlertCircle, MinusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mediforce, ApiError } from '@/lib/mediforce';
import { ParamField } from '@/components/ui/param-field';
import type { TaskVerdict, StepParam } from '@mediforce/platform-core';
import type { TaskBodyProps } from './task-body-registry';

type Intent = 'success' | 'warning' | 'danger' | 'neutral';

const INTENT_STYLES: Record<Intent, { submit: string; Icon: typeof CheckCircle }> = {
  success: { submit: 'bg-green-600 text-white hover:bg-green-700', Icon: CheckCircle },
  warning: { submit: 'bg-yellow-600 text-white hover:bg-yellow-700', Icon: AlertCircle },
  danger:  { submit: 'bg-red-600 text-white hover:bg-red-700',    Icon: XCircle },
  neutral: { submit: 'bg-secondary text-secondary-foreground hover:bg-secondary/80', Icon: MinusCircle },
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
    return <CompletionReadOnly completionData={task.completionData} params={task.params ?? []} />;
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
      {/* Param fields */}
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

      {/* Optional comment */}
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

      {/* Verdict buttons */}
      <div className="flex flex-wrap items-start gap-3">
        {verdicts.map((cfg) => {
          const intent = (cfg.intent ?? 'neutral') as Intent;
          const styles = INTENT_STYLES[intent] ?? INTENT_STYLES.neutral;
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
}: {
  completionData: unknown;
  params: StepParam[];
}) {
  const data = completionData as Record<string, unknown>;
  const verdict = data.verdict as string | undefined;
  const comment = data.comment as string | undefined;
  const paramValues = data.paramValues as Record<string, unknown> | undefined;

  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-2 dark:bg-green-900/20 dark:border-green-800">
      <div className="flex items-center gap-2">
        <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
        <span className="font-medium text-sm text-green-800 dark:text-green-300">Submitted</span>
      </div>
      {verdict && (
        <p className="text-sm text-green-800 dark:text-green-300">
          <span className="font-medium">Choice:</span> {verdict}
        </p>
      )}
      {comment && (
        <p className="text-sm text-green-800 dark:text-green-300">
          <span className="font-medium">Comment:</span> {comment}
        </p>
      )}
      {paramValues && params.map((p) => {
        const val = paramValues[p.name];
        if (val === undefined || val === '') return null;
        return (
          <p key={p.name} className="text-sm text-green-800 dark:text-green-300">
            <span className="font-medium">{p.name}:</span> {String(val)}
          </p>
        );
      })}
    </div>
  );
}
