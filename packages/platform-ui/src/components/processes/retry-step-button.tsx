'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { RotateCw, Check } from 'lucide-react';
import { retryFailedStep } from '@/app/actions/processes';
import { cn } from '@/lib/utils';

interface RetryStepButtonProps {
  instanceId: string;
  stepId: string;
}

type Status = 'idle' | 'submitting' | 'refreshing' | 'success' | 'error';

export function RetryStepButton({ instanceId, stepId }: RetryStepButtonProps) {
  const router = useRouter();
  const [, startTransition] = React.useTransition();
  const [status, setStatus] = React.useState<Status>('idle');
  const [error, setError] = React.useState<string | null>(null);

  async function handleClick(event: React.MouseEvent) {
    event.stopPropagation();
    setStatus('submitting');
    setError(null);

    const result = await retryFailedStep(instanceId, stepId);

    if (!result.success) {
      setError(result.error ?? 'Retry failed');
      setStatus('error');
      return;
    }

    setStatus('success');
    startTransition(() => {
      router.refresh();
    });
    window.setTimeout(() => {
      setStatus((current) => (current === 'success' ? 'refreshing' : current));
    }, 1200);
  }

  const busy = status === 'submitting' || status === 'refreshing' || status === 'success';
  const label =
    status === 'submitting' ? 'Queuing retry\u2026'
    : status === 'success' ? 'Retry queued'
    : status === 'refreshing' ? 'Restarting step\u2026'
    : 'Retry';

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={handleClick}
        aria-busy={busy}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium shadow-sm',
          'bg-background hover:bg-muted disabled:cursor-not-allowed',
          status === 'success' && 'border-emerald-500/60 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
          busy && status !== 'success' && 'bg-muted',
        )}
      >
        {status === 'success'
          ? <Check className="h-3.5 w-3.5" />
          : <RotateCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
        }
        {label}
      </button>
      {error !== null && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
