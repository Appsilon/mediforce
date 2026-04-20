'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { RotateCw } from 'lucide-react';
import { retryFailedStep } from '@/app/actions/processes';
import { cn } from '@/lib/utils';

interface RetryStepButtonProps {
  instanceId: string;
  stepId: string;
}

export function RetryStepButton({ instanceId, stepId }: RetryStepButtonProps) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleClick(event: React.MouseEvent) {
    event.stopPropagation();
    setPending(true);
    setError(null);
    const result = await retryFailedStep(instanceId, stepId);
    setPending(false);
    if (!result.success) {
      setError(result.error ?? 'Retry failed');
      return;
    }
    router.refresh();
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={handleClick}
        className={cn(
          'inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium',
          'hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        <RotateCw className={cn('h-3 w-3', pending && 'animate-spin')} />
        {pending ? 'Retrying\u2026' : 'Retry'}
      </button>
      {error !== null && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
