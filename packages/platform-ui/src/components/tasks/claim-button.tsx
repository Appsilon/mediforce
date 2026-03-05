'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { claimTask } from '@/app/actions/tasks';
import { cn } from '@/lib/utils';

/**
 * One-click claim button. No confirmation dialog (per user decision).
 * Calls the claimTask server action directly on click.
 */
export function ClaimButton({
  taskId,
  currentUserId,
  fullWidth = false,
  onClaimed,
}: {
  taskId: string;
  currentUserId: string;
  fullWidth?: boolean;
  onClaimed?: () => void;
}) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleClaim() {
    setPending(true);
    setError(null);
    try {
      const result = await claimTask(taskId, currentUserId);
      if (result.success) {
        onClaimed?.();
      } else {
        setError(result.error ?? 'Failed to claim task');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim task');
    } finally {
      setPending(false);
    }
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

/**
 * Unclaim button — releases a task back to the queue.
 * Styled as a subtle text button.
 */
export function UnclaimButton({
  taskId,
  currentUserId,
  onUnclaimed,
}: {
  taskId: string;
  currentUserId: string;
  onUnclaimed?: () => void;
}) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleUnclaim() {
    setPending(true);
    setError(null);
    try {
      const { unclaimTask } = await import('@/app/actions/tasks');
      const result = await unclaimTask(taskId, currentUserId);
      if (result.success) {
        onUnclaimed?.();
      } else {
        setError(result.error ?? 'Failed to release task');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to release task');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        onClick={handleUnclaim}
        disabled={pending}
        className={cn(
          'inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        {pending ? 'Releasing...' : 'Release task'}
      </button>
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
