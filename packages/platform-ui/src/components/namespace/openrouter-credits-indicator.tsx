'use client';

import * as React from 'react';
import { Eye, EyeOff, Wallet } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { mediforce } from '@/lib/mediforce';
import type { OpenRouterCreditsOutput } from '@mediforce/platform-api/contract';
import { cn } from '@/lib/utils';

type NamespaceOpenRouterCredits = OpenRouterCreditsOutput;

const STORAGE_KEY = 'mediforce:show-credits';
const LOW_CREDITS_THRESHOLD = 5;

interface OpenRouterCreditsIndicatorProps {
  handle: string;
}

export function OpenRouterCreditsIndicator({ handle }: OpenRouterCreditsIndicatorProps) {
  const { user } = useAuth();
  const [credits, setCredits] = React.useState<NamespaceOpenRouterCredits | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [hidden, setHidden] = React.useState(true);

  React.useEffect(() => {
    setHidden(localStorage.getItem(STORAGE_KEY) !== '1');
  }, []);

  React.useEffect(() => {
    if (!handle || !user?.id) return;
    let cancelled = false;
    setLoading(true);
    mediforce.system
      .credits({ namespace: handle })
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
  }, [handle, user?.id]);

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

  const isLow = !hidden && credits.effectiveRemaining <= LOW_CREDITS_THRESHOLD;
  const isExhausted = !hidden && credits.effectiveRemaining <= 0;
  const accountPart =
    credits.accountRemaining === undefined
      ? null
      : ` / $${credits.accountRemaining.toFixed(2)} credits`;

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
              ${credits.effectiveRemaining.toFixed(2)}
            </span>
            <span className="text-xs text-muted-foreground">
              (${credits.remaining.toFixed(2)} key limit{accountPart})
            </span>
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
