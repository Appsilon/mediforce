'use client';

import * as React from 'react';
import { Loader2, Send } from 'lucide-react';
import { mediforce } from '@/lib/mediforce';
import { cn } from '@/lib/utils';
import { ParamField } from '@/components/ui/param-field';
import type { StepParam } from '@mediforce/platform-core';

interface ParamsFormProps {
  taskId: string;
  params: StepParam[];
  remainingTaskCount?: number;
  onCompleted?: () => void;
}

export function useParamValues(params: StepParam[]) {
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

  const requiredMissing = params.some((p) => p.required && (values[p.name] === undefined || values[p.name] === ''));

  function setValue(name: string, value: unknown) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  function coerce(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const param of params) {
      const raw = values[param.name];
      result[param.name] = param.type === 'number' ? (raw === '' ? undefined : Number(raw)) : raw;
    }
    return result;
  }

  return { values, setValue, requiredMissing, coerce };
}

export function ParamsForm({ taskId, params, remainingTaskCount, onCompleted }: ParamsFormProps) {
  const { values, setValue, requiredMissing, coerce } = useParamValues(params);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (requiredMissing || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      await mediforce.tasks.complete({
        taskId,
        payload: { kind: 'params', paramValues: coerce() },
      });
      onCompleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    }

    setSubmitting(false);
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

      {error && <p className="text-sm text-destructive">{error}</p>}

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
