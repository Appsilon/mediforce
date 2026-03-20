'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { CheckCircle, Loader2, Send } from 'lucide-react';
import { completeParamsTask } from '@/app/actions/tasks';
import { cn } from '@/lib/utils';
import type { StepParam } from '@mediforce/platform-core';

interface ParamsFormProps {
  taskId: string;
  params: StepParam[];
  remainingTaskCount?: number;
  onCompleted?: () => void;
}

interface SubmittedValues {
  values: Record<string, unknown>;
  timestamp: string;
}

export function ParamsForm({
  taskId,
  params,
  remainingTaskCount,
  onCompleted,
}: ParamsFormProps) {
  const [values, setValues] = React.useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const param of params) {
      if (param.default !== undefined) {
        initial[param.name] = param.default;
      } else if (param.type === 'boolean') {
        initial[param.name] = false;
      } else {
        initial[param.name] = '';
      }
    }
    return initial;
  });
  const [submitting, setSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState<SubmittedValues | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const requiredMissing = params.some(
    (param) => param.required && (values[param.name] === '' || values[param.name] === undefined),
  );

  function setValue(name: string, value: unknown) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (requiredMissing || submitting) return;

    setSubmitting(true);
    setError(null);

    // Coerce types before sending
    const coerced: Record<string, unknown> = {};
    for (const param of params) {
      const raw = values[param.name];
      if (param.type === 'number') {
        coerced[param.name] = raw === '' ? undefined : Number(raw);
      } else {
        coerced[param.name] = raw;
      }
    }

    const result = await completeParamsTask(taskId, coerced);

    if (result.success) {
      setSubmitted({ values: coerced, timestamp: new Date().toISOString() });
      onCompleted?.();
    } else {
      setError(result.error ?? 'Failed to submit');
    }

    setSubmitting(false);
  }

  if (submitted) {
    return <ParamsConfirmation data={submitted} params={params} remainingTaskCount={remainingTaskCount} />;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-lg border p-4 space-y-4">
        {params.map((param) => (
          <ParamField
            key={param.name}
            param={param}
            value={values[param.name]}
            onChange={(value) => setValue(param.name, value)}
            disabled={submitting}
          />
        ))}
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <button
        type="submit"
        disabled={requiredMissing || submitting}
        className={cn(
          'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
          'bg-primary text-primary-foreground hover:bg-primary/90',
          (requiredMissing || submitting) && 'opacity-50 cursor-not-allowed',
        )}
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {submitting ? 'Submitting...' : 'Submit'}
      </button>
    </form>
  );
}

function ParamField({
  param,
  value,
  onChange,
  disabled,
}: {
  param: StepParam;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
}) {
  const inputClasses = cn(
    'w-full rounded-md border bg-background px-3 py-2 text-sm',
    'placeholder:text-muted-foreground',
    'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary',
    disabled && 'opacity-50 cursor-not-allowed',
  );

  return (
    <div className="space-y-1.5">
      <label className="flex items-baseline gap-1.5 text-sm font-medium">
        {param.name}
        {param.required && <span className="text-destructive">*</span>}
      </label>
      {param.description && (
        <p className="text-xs text-muted-foreground">{param.description}</p>
      )}

      {param.type === 'boolean' ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => onChange(event.target.checked)}
            disabled={disabled}
            className="h-4 w-4 rounded border"
          />
          {param.description ?? param.name}
        </label>
      ) : param.type === 'number' ? (
        <input
          type="number"
          value={value === undefined ? '' : String(value)}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          placeholder={param.default !== undefined ? String(param.default) : undefined}
          className={inputClasses}
        />
      ) : param.type === 'date' ? (
        <input
          type="date"
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className={inputClasses}
        />
      ) : (
        <textarea
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          placeholder={param.default !== undefined ? String(param.default) : undefined}
          rows={3}
          className={cn(inputClasses, 'resize-y min-h-[72px]')}
        />
      )}
    </div>
  );
}

// --- Post-submission confirmation ---

function ParamsConfirmation({
  data,
  params,
  remainingTaskCount,
}: {
  data: SubmittedValues;
  params: StepParam[];
  remainingTaskCount?: number;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:bg-green-900/20 dark:border-green-800">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
          <span className="font-medium text-sm text-green-800 dark:text-green-300">
            Submitted successfully
          </span>
        </div>

        <dl className="space-y-2">
          {params.map((param) => {
            const displayValue = data.values[param.name];
            if (displayValue === undefined || displayValue === '') return null;
            return (
              <div key={param.name}>
                <dt className="text-xs font-medium text-green-700/70 dark:text-green-400/70">
                  {param.name}
                </dt>
                <dd className="text-sm text-green-800 dark:text-green-300 whitespace-pre-wrap">
                  {String(displayValue)}
                </dd>
              </div>
            );
          })}
        </dl>

        <p className="mt-2 text-xs text-green-600/70 dark:text-green-400/70">
          {format(new Date(data.timestamp), 'MMM d, yyyy HH:mm')}
        </p>
      </div>

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
 * Read-only params confirmation for already completed tasks.
 */
export function ParamsConfirmationReadOnly({
  completionData,
  params,
}: {
  completionData: Record<string, unknown>;
  params: StepParam[];
}) {
  const paramValues = (completionData.paramValues as Record<string, unknown>) ?? {};
  const timestamp = (completionData.completedAt as string) ?? '';

  return (
    <ParamsConfirmation
      data={{ values: paramValues, timestamp }}
      params={params}
    />
  );
}
