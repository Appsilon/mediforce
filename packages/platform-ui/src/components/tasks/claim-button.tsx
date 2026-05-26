'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { mediforce } from '@/lib/mediforce';
import { cn } from '@/lib/utils';

export function ClaimButton({
  taskId,
  fullWidth = false,
  variant = 'default',
  onClaimed,
}: {
  taskId: string;
  fullWidth?: boolean;
  variant?: 'default' | 'inline';
  onClaimed?: () => void;
}) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleClaim() {
    setPending(true);
    setError(null);
    try {
      await mediforce.tasks.claim({ taskId });
      onClaimed?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim task');
    } finally {
      setPending(false);
    }
  }

  if (variant === 'inline') {
    return (
      <button
        onClick={handleClaim}
        disabled={pending}
        className="inline-flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 px-2 py-1 rounded hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
      >
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Claim'}
      </button>
    );
  }

  return (
    <div className="space-y-1">
      <button
        onClick={handleClaim}
        disabled={pending}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary',
          'hover:bg-primary hover:text-primary-foreground transition-colors',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          fullWidth && 'w-full',
        )}
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {pending ? 'Claiming...' : 'Claim Task'}
      </button>
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
