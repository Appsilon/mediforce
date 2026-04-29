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

type Status = 'idle' | 'submitting' | 'success' | 'error';

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

    // router.refresh() re-renders the run detail; once the server reflects
    // the flipped status, either the step card leaves the 'failed' branch
    // (and this component unmounts) or the button remains — either way the
    // 'success' chip is the final user-visible state. No timed transition:
    // it leaked state updates when the component unmounted inside the delay.
    setStatus('success');
    startTransition(() => {
      router.refresh();
    });
  }

  const busy = status === 'submitting' || status === 'success';
  const label =
    status === 'submitting' ? 'Starting…'
    : status === 'success' ? 'Started'
    : 'Run again this step';

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
      {error !== null && (
        <pre className="text-xs font-mono text-destructive whitespace-pre-wrap break-all select-text max-w-sm">
          {error}
        </pre>
      )}
    </div>
  );
}
