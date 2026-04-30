'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { RotateCw, XCircle, Check } from 'lucide-react';
import { retryFailedStep, cancelProcessRun } from '@/app/actions/processes';
import { cn } from '@/lib/utils';

interface AgentEscalatedBannerProps {
  instanceId: string;
  stepId: string;
}

type RetryStatus = 'idle' | 'submitting' | 'success' | 'error';
type CancelStatus = 'idle' | 'submitting' | 'error';

export function AgentEscalatedBanner({ instanceId, stepId }: AgentEscalatedBannerProps) {
  const router = useRouter();
  const [, startTransition] = React.useTransition();
  const [retryStatus, setRetryStatus] = React.useState<RetryStatus>('idle');
  const [retryError, setRetryError] = React.useState<string | null>(null);
  const [cancelStatus, setCancelStatus] = React.useState<CancelStatus>('idle');
  const [cancelError, setCancelError] = React.useState<string | null>(null);

  async function handleRetry() {
    setRetryStatus('submitting');
    setRetryError(null);
    const result = await retryFailedStep(instanceId, stepId);
    if (!result.success) {
      setRetryError(result.error ?? 'Retry failed');
      setRetryStatus('error');
      return;
    }
    setRetryStatus('success');
    startTransition(() => { router.refresh(); });
  }

  async function handleCancel() {
    setCancelStatus('submitting');
    setCancelError(null);
    const result = await cancelProcessRun(instanceId);
    if (!result.success) {
      setCancelError(result.error ?? 'Cancel failed');
      setCancelStatus('idle');
      return;
    }
    startTransition(() => { router.refresh(); });
  }

  const retryBusy = retryStatus === 'submitting' || retryStatus === 'success';
  const cancelBusy = cancelStatus === 'submitting';
  const anyBusy = retryBusy || cancelBusy;

  return (
    <div className="rounded-md border border-border bg-card px-4 py-4 space-y-3">
      <p className="text-sm text-foreground">
        The agent step failed and needs your decision. You can fix the underlying issue and retry
        the step, or cancel this run.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={anyBusy}
          onClick={handleRetry}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            'bg-primary text-primary-foreground hover:bg-primary/90',
            'disabled:cursor-not-allowed disabled:opacity-50',
            retryStatus === 'success' && 'bg-emerald-600 hover:bg-emerald-600',
          )}
        >
          {retryStatus === 'success'
            ? <Check className="h-3.5 w-3.5" />
            : <RotateCw className={cn('h-3.5 w-3.5', retryStatus === 'submitting' && 'animate-spin')} />
          }
          {retryStatus === 'submitting' ? 'Starting…' : retryStatus === 'success' ? 'Started' : 'Fixed, try again'}
        </button>
        <button
          type="button"
          disabled={anyBusy}
          onClick={handleCancel}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            'border border-destructive text-destructive hover:bg-destructive/10',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <XCircle className={cn('h-3.5 w-3.5', cancelBusy && 'animate-spin')} />
          {cancelBusy ? 'Cancelling…' : 'Cancel this run'}
        </button>
      </div>
      {retryError !== null && (
        <p className="text-xs text-destructive">{retryError}</p>
      )}
      {cancelError !== null && (
        <p className="text-xs text-destructive">{cancelError}</p>
      )}
    </div>
  );
}
