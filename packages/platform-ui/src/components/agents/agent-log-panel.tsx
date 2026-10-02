'use client';

import { X } from 'lucide-react';
import type { AgentEvent, AgentRun } from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { useAgentEvents } from '@/hooks/use-agent-events';
import { AgentLogViewer } from '@/components/processes/agent-log-viewer';

const LOG_EVENT_PREFIX = 'agent activity log: ';

/** Mirrors process-detail.tsx's agentLogFiles derivation: the AgentRunner
 *  announces where its log file lives via a status AgentEvent, since the
 *  file itself is host-local (not a DB/queryable artifact). */
function resolveLogFile(events: AgentEvent[]): string | null {
  const event = events.find(
    (e) => e.type === 'status' && typeof e.payload === 'string' && e.payload.startsWith(LOG_EVENT_PREFIX),
  );
  if (!event) return null;
  const fullPath = (event.payload as string).slice(LOG_EVENT_PREFIX.length);
  return fullPath.split('/').pop() ?? null;
}

/** One agent run's execution log, as the AgentRunner wrote it. */
export function AgentRunLog({ run }: { run: AgentRun }) {
  const { data: events, loading } = useAgentEvents(run.processInstanceId, run.stepId, undefined);
  const logFile = resolveLogFile(events);
  if (loading) return <p className="text-xs text-muted-foreground py-8 text-center">Loading…</p>;
  if (logFile === null) return <p className="text-xs text-muted-foreground py-8 text-center">no data</p>;
  return <AgentLogViewer logFiles={[{ stepId: run.stepId, file: logFile, executor: 'agent' }]} />;
}

/**
 * Right-side overlay showing one agent run's execution log. Slides in over
 * the table (fixed position + backdrop) rather than squeezing it — the
 * table's width never changes.
 */
export function AgentLogPanel({ run, onClose }: { run: AgentRun | null; onClose: () => void }) {
  const isOpen = run !== null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-40 bg-black/20 transition-opacity duration-300 ease-in-out',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
      />

      {/* Panel */}
      <div
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l bg-background shadow-xl',
          'transition-transform duration-300 ease-in-out',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-center justify-between border-b px-4 py-2 shrink-0">
          <span className="text-sm font-medium">Agent Log</span>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Close panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 p-4 flex flex-col overflow-hidden">
          {run !== null && <AgentRunLog run={run} />}
        </div>
      </div>
    </>
  );
}
