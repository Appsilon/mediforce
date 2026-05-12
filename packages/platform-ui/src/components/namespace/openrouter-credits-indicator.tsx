'use client';

import * as React from 'react';
import { Eye, EyeOff, Wallet } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { getOpenRouterCredits, type NamespaceOpenRouterCredits } from '@/app/actions/namespace-secrets';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'mediforce:show-credits';
const LOW_CREDITS_THRESHOLD = 5;

interface OpenRouterCreditsIndicatorProps {
  handle: string;
}

export function OpenRouterCreditsIndicator({ handle }: OpenRouterCreditsIndicatorProps) {
  const { firebaseUser } = useAuth();
  const [credits, setCredits] = React.useState<NamespaceOpenRouterCredits | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [hidden, setHidden] = React.useState(true);

  React.useEffect(() => {
    setHidden(localStorage.getItem(STORAGE_KEY) !== '1');
  }, []);

  React.useEffect(() => {
    if (!handle || !firebaseUser?.uid) return;
    let cancelled = false;
    setLoading(true);
    getOpenRouterCredits(handle, firebaseUser.uid)
      .then((result) => {
        if (!cancelled) {
          setCredits(result);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [handle, firebaseUser?.uid]);

  function toggleVisibility() {
    const next = !hidden;
    setHidden(next);
    if (next) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, '1');
    }
  }

  if (loading || !credits?.available) return null;

  const isLow = !hidden && credits.remaining <= LOW_CREDITS_THRESHOLD;
  const isExhausted = !hidden && credits.remaining <= 0;

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-2',
        hidden
          ? 'border-border bg-muted/30'
          : isExhausted
            ? 'border-red-200 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/20'
            : isLow
              ? 'border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20'
              : 'border-border bg-card',
      )}
    >
      <Wallet className={cn('h-4 w-4 shrink-0', hidden ? 'text-muted-foreground/50' : isExhausted ? 'text-red-600 dark:text-red-400' : isLow ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')} />
      <div className="flex items-center gap-1.5 text-sm min-w-0">
        <span className={cn('text-muted-foreground', hidden && 'text-muted-foreground/50')}>OpenRouter</span>
        {hidden ? (
          <span className="text-muted-foreground/50">••••</span>
        ) : (
          <>
            <span
              className={cn(
                'font-medium font-mono',
                isExhausted
                  ? 'text-red-700 dark:text-red-400'
                  : isLow
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-foreground',
              )}
            >
              ${credits.remaining.toFixed(2)}
            </span>
            {isLow && (
              <span className="text-xs text-muted-foreground">
                / ${credits.limit.toFixed(2)}
              </span>
            )}
          </>
        )}
      </div>
      <button
        type="button"
        onClick={toggleVisibility}
        className="ml-auto rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        aria-label={hidden ? 'Show balance' : 'Hide balance'}
        title={hidden ? 'Show balance' : 'Hide balance'}
      >
        {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
