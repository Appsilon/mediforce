'use client';

import * as React from 'react';
import { Wrench, Loader2, ChevronDown, ChevronRight, AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConversationTurn } from '@mediforce/platform-core';

// ---------------------------------------------------------------------------
// Elapsed timer for running state
// ---------------------------------------------------------------------------

function ElapsedTimer() {
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => setElapsed((prev) => prev + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  return <span className="font-mono text-[10px] text-muted-foreground">{elapsed}s</span>;
}

// ---------------------------------------------------------------------------
// ToolCallBubble — renders a tool turn (running / success / error)
// ---------------------------------------------------------------------------

export function ToolCallBubble({ turn }: { turn: ConversationTurn }) {
  const [expanded, setExpanded] = React.useState(false);

  const status = turn.toolStatus ?? 'running';
  const displayName = turn.toolName ?? 'unknown tool';
  // Strip server namespace prefix for cleaner display
  const shortName = displayName.includes('__')
    ? displayName.slice(displayName.indexOf('__') + 2)
    : displayName;

  const hasResult = status === 'success' && turn.toolResult;
  const hasError = status === 'error';

  return (
    <div className="ml-9 my-0.5">
      <div
        className={cn(
          'rounded-md border-l-2 px-3 py-1.5 text-xs',
          status === 'running' && 'border-l-blue-400 bg-blue-50 dark:bg-blue-950/20',
          status === 'success' && 'border-l-green-400 bg-green-50 dark:bg-green-950/20',
          status === 'error' && 'border-l-red-400 bg-red-50 dark:bg-red-950/20',
        )}
      >
        {/* Header row */}
        <button
          onClick={() => (hasResult || hasError) && setExpanded(!expanded)}
          disabled={!hasResult && !hasError}
          className={cn(
            'flex items-center gap-1.5 w-full text-left',
            (hasResult || hasError) && 'cursor-pointer hover:opacity-80',
          )}
        >
          {status === 'running' && (
            <Loader2 className="h-3 w-3 animate-spin text-blue-500 shrink-0" />
          )}
          {status === 'success' && (
            <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400 shrink-0" />
          )}
          {status === 'error' && (
            <AlertCircle className="h-3 w-3 text-red-600 dark:text-red-400 shrink-0" />
          )}

          <Wrench className="h-3 w-3 text-muted-foreground shrink-0" />

          <span className="text-muted-foreground">
            {status === 'running' ? `Calling ${shortName}` : shortName}
          </span>

          {status === 'running' && <ElapsedTimer />}

          {(hasResult || hasError) && (
            expanded
              ? <ChevronDown className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />
              : <ChevronRight className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />
          )}
        </button>

        {/* Expanded result */}
        {expanded && hasResult && (
          <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground max-h-48 overflow-y-auto">
            {turn.toolResult}
          </pre>
        )}

        {expanded && hasError && (
          <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">
            {turn.toolResult ?? 'Tool call failed'}
          </p>
        )}
      </div>
    </div>
  );
}
