'use client';

import * as React from 'react';
import { CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mediforce, ApiError } from '@/lib/mediforce';
import { ParamField } from '@/components/ui/param-field';
import type { TaskVerdict, StepParam } from '@mediforce/platform-core';
import type { TaskBodyProps } from './task-body-registry';
import { useParamValues } from './params-form';
import { VerdictButtons, VerdictConfirmationReadOnly, RemainingTasksFooter } from './verdict-form';

export function ParamVerdictView({ task, remainingTaskCount }: TaskBodyProps) {
  const isActionable = task.status === 'claimed' || task.status === 'pending';
  const isCompleted = task.status === 'completed';

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
      <VerdictConfirmationReadOnly
        completionData={task.completionData}
        verdicts={task.verdicts}
        params={task.params}
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
  const { values, setValue, requiredMissing, coerce } = useParamValues(params);
  const [comment, setComment] = React.useState('');
  const [submitting, setSubmitting] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const trimmedComment = comment.trim();

  async function handleVerdict(cfg: TaskVerdict) {
    if (requiredMissing) return;
    if (cfg.requiresComment && !trimmedComment) return;
    if (submitting !== null) return;

    setSubmitting(cfg.key);
    setError(null);

    try {
      await mediforce.tasks.complete({
        taskId,
        payload: {
          kind: 'verdict-with-params',
          verdict: cfg.key,
          comment: trimmedComment || undefined,
          paramValues: coerce(),
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
      <div className="space-y-4">
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:bg-green-900/20 dark:border-green-800">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
            <span className="font-medium text-sm text-green-800 dark:text-green-300">
              Submitted successfully
            </span>
          </div>
        </div>
        <RemainingTasksFooter remainingTaskCount={remainingTaskCount} />
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

      <VerdictButtons
        verdicts={verdicts}
        submitting={submitting}
        trimmedComment={trimmedComment}
        outerBlocked={requiredMissing}
        outerBlockedHint="Fill required fields first"
        onVerdict={handleVerdict}
      />
    </div>
  );
}
