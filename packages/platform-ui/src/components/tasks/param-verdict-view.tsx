'use client';

import * as React from 'react';
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

function isParamBlockedForVerdict(verdictKey: string, params: StepParam[], values: Record<string, unknown>): boolean {
  return params.some((p) => {
    const val = values[p.name];
    const missing = val === undefined || val === '';
    if (!missing) return false;
    return p.required || p.requiredForVerdicts?.includes(verdictKey) === true;
  });
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
  const { values, setValue, coerce } = useParamValues(params);
  const [comment, setComment] = React.useState('');
  const [submitting, setSubmitting] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const trimmedComment = comment.trim();

  async function handleVerdict(cfg: TaskVerdict) {
    if (isParamBlockedForVerdict(cfg.key, params, values)) return;
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
    return <RemainingTasksFooter remainingTaskCount={remainingTaskCount} />;
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
        isVerdictBlocked={(key) => isParamBlockedForVerdict(key, params, values)}
        outerBlockedHint="Fill required fields first"
        onVerdict={handleVerdict}
      />
    </div>
  );
}
