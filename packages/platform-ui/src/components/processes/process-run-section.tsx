'use client';

import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { ChevronRight } from 'lucide-react';
import type { ProcessInstance } from '@mediforce/platform-core';
import { StatusDot } from '@/components/ui/status-dot';
import { cn } from '@/lib/utils';

function toHumanLabel(identifier: string): string {
  return identifier
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function StepProgress({ steps, currentStepId, status }: { steps: string[]; currentStepId: string | null; status: string }) {
  if (steps.length === 0) return null;
  const isCompleted = status === 'completed';
  const currentIndex = currentStepId ? steps.indexOf(currentStepId) : -1;

  function dotClass(index: number): string {
    if (isCompleted) return 'bg-green-500/60';
    if (index < currentIndex) return 'bg-green-500/60';
    if (index === currentIndex) {
      if (status === 'running') return 'ring-[1.5px] ring-blue-500 bg-transparent';
      if (status === 'paused') return 'ring-[1.5px] ring-amber-500 bg-transparent';
      if (status === 'failed') return 'ring-[1.5px] ring-red-500 bg-transparent';
      return 'ring-[1.5px] ring-primary bg-transparent';
    }
    return 'bg-border';
  }

  const title = isCompleted
    ? `Completed (${steps.length} steps)`
    : currentIndex >= 0
      ? `Step ${currentIndex + 1} of ${steps.length}`
      : `${steps.length} steps`;

  return (
    <div className="flex items-center gap-0.5 shrink-0" title={title}>
      {steps.map((stepId, index) => (
        <span
          key={stepId}
          className={cn(
            'rounded-full',
            'w-1.5 h-1.5',
            dotClass(index),
          )}
        />
      ))}
    </div>
  );
}

export function ProcessInstanceRow({ instance, showProcess = false, steps }: { instance: ProcessInstance; showProcess?: boolean; steps?: string[] }) {
  const shortHash = `#${instance.id.slice(0, 6)}`;
  const currentStep = instance.currentStepId
    ? toHumanLabel(instance.currentStepId)
    : null;
  const timeAgo = formatDistanceToNow(new Date(instance.createdAt), { addSuffix: true });
  const detailHref = `/processes/${encodeURIComponent(instance.definitionName)}/runs/${instance.id}`;
  const isTerminal = instance.status === 'completed' || instance.status === 'failed';

  return (
    <Link
      href={detailHref}
      className="group flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors border-b border-border/40 last:border-b-0"
    >
      <StatusDot status={instance.status} />
      <span className="font-mono text-xs text-muted-foreground w-[58px] shrink-0">
        {shortHash}
      </span>
      {showProcess && (
        <span className="text-xs text-muted-foreground truncate max-w-[140px] shrink-0">
          {toHumanLabel(instance.definitionName)}
        </span>
      )}
      {steps && steps.length > 0 && (
        <StepProgress steps={steps} currentStepId={instance.currentStepId} status={instance.status} />
      )}
      {isTerminal ? (
        <span className="text-sm flex-1 truncate text-muted-foreground">
          {instance.status === 'failed' ? 'Failed' : 'Completed'}
        </span>
      ) : (
        <span className="flex-1 truncate">
          <span className="inline-flex bg-muted/50 rounded px-1.5 py-0.5 text-xs font-medium">
            {currentStep ?? 'Starting...'}
          </span>
        </span>
      )}
      <span className="text-xs text-muted-foreground tabular-nums shrink-0">
        {timeAgo}
      </span>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
    </Link>
  );
}
