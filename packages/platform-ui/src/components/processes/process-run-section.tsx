'use client';

import * as React from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { ChevronRight, ExternalLink } from 'lucide-react';
import type { ProcessInstance } from '@mediforce/platform-core';
import { StatusDot } from '@/components/ui/status-dot';

function toHumanLabel(identifier: string): string {
  return identifier
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function StepDots({
  steps,
  currentStepId,
  instanceStatus,
}: {
  steps: string[];
  currentStepId: string | null;
  instanceStatus: string;
}) {
  if (steps.length === 0) return null;
  const isCompleted = instanceStatus === 'completed';
  const currentIndex = currentStepId ? steps.indexOf(currentStepId) : -1;

  const title = isCompleted
    ? `Completed (${steps.length} steps)`
    : currentIndex >= 0
      ? `Step ${currentIndex + 1} of ${steps.length}`
      : `${steps.length} steps`;

  return (
    <div className="flex items-center gap-0.5 shrink-0" title={title}>
      {steps.map((stepId, index) => {
        let dotClass: string;
        if (isCompleted) {
          dotClass = 'bg-green-500/60';
        } else if (index < currentIndex) {
          dotClass = 'bg-green-500/60';
        } else if (index === currentIndex) {
          if (instanceStatus === 'running') dotClass = 'ring-[1.5px] ring-blue-500 bg-transparent animate-pulse';
          else if (instanceStatus === 'paused') dotClass = 'ring-[1.5px] ring-amber-500 bg-transparent';
          else if (instanceStatus === 'failed') dotClass = 'ring-[1.5px] ring-red-500 bg-transparent';
          else dotClass = 'ring-[1.5px] ring-primary bg-transparent';
        } else {
          dotClass = 'bg-border';
        }
        return (
          <span
            key={stepId}
            className={`w-1.5 h-1.5 rounded-full ${dotClass}`}
            title={toHumanLabel(stepId)}
          />
        );
      })}
    </div>
  );
}

function StepProgressBar({
  steps,
  currentStepId,
  instanceStatus,
}: {
  steps: string[];
  currentStepId: string | null;
  instanceStatus: string;
}) {
  if (steps.length === 0) return null;

  if (instanceStatus === 'completed') {
    return (
      <span className="text-xs text-green-600/70 dark:text-green-400/70 truncate flex-1">
        ✓ Completed ({steps.length} steps)
      </span>
    );
  }

  if (instanceStatus === 'failed') {
    const failedAt = currentStepId ? toHumanLabel(currentStepId) : null;
    return (
      <span className="text-xs text-red-600/70 dark:text-red-400/70 truncate flex-1">
        {failedAt ? `✗ Failed at ${failedAt}` : '✗ Failed'}
      </span>
    );
  }

  const currentIndex = currentStepId ? steps.indexOf(currentStepId) : -1;

  return (
    <div className="flex items-center gap-px flex-1 min-w-0 h-5">
      {steps.map((stepId, index) => {
        const label = toHumanLabel(stepId);
        const isCompleted = index < currentIndex;
        const isCurrent = index === currentIndex;

        if (isCurrent) {
          const isPaused = instanceStatus === 'paused';
          const isRunning = instanceStatus === 'running';
          return (
            <div
              key={stepId}
              className={[
                'flex-1 max-w-[200px] min-w-[80px] h-full flex items-center rounded px-1.5',
                isPaused
                  ? 'bg-blue-500/10 border border-blue-500/20'
                  : 'bg-primary/15 border border-primary/20',
                isRunning ? 'animate-pulse' : '',
              ].filter(Boolean).join(' ')}
              title={label}
            >
              <span
                className={`text-[11px] font-medium truncate ${isPaused ? 'text-blue-600 dark:text-blue-400' : 'text-primary'}`}
              >
                {label}
              </span>
            </div>
          );
        }

        if (isCompleted) {
          return (
            <div
              key={stepId}
              className="w-3 shrink-0 h-full rounded-sm bg-green-500/30 dark:bg-green-500/20"
              title={`✓ ${label}`}
            />
          );
        }

        return (
          <div
            key={stepId}
            className="w-3 shrink-0 h-full rounded-sm bg-border/40"
            title={label}
          />
        );
      })}
    </div>
  );
}

function shortTimeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 7)}w ago`;
}

export function ProcessInstanceRow({ instance, showProcess = false, steps, stepStyle = 'dots', activeTaskId }: { instance: ProcessInstance; showProcess?: boolean; steps?: string[]; stepStyle?: 'dots' | 'bar'; activeTaskId?: string }) {
  const shortHash = `#${instance.id.slice(0, 6)}`;
  const timeAgo = shortTimeAgo(new Date(instance.createdAt));
  const fullTimeAgo = formatDistanceToNow(new Date(instance.createdAt), { addSuffix: true });
  const detailHref = `/workflows/${encodeURIComponent(instance.definitionName)}/runs/${instance.id}`;

  return (
    <Link
      href={detailHref}
      className="group flex items-center gap-2 px-4 py-1.5 min-h-[36px] hover:bg-muted/50 transition-colors border-b border-border/40 last:border-b-0"
    >
      <StatusDot status={instance.status} />
      <span className="font-mono text-xs text-muted-foreground w-[52px] shrink-0">
        {shortHash}
      </span>
      {showProcess && (
        <span className="text-xs text-muted-foreground truncate max-w-[120px] shrink-0">
          {toHumanLabel(instance.definitionName)}
        </span>
      )}
      {stepStyle === 'bar' ? (
        <StepProgressBar
          steps={steps ?? []}
          currentStepId={instance.currentStepId}
          instanceStatus={instance.status}
        />
      ) : (
        <>
          <StepDots
            steps={steps ?? []}
            currentStepId={instance.currentStepId}
            instanceStatus={instance.status}
          />
          {instance.status === 'completed' || instance.status === 'failed' ? (
            <span className="text-xs text-muted-foreground truncate flex-1">
              {instance.status === 'failed' ? 'Failed' : 'Completed'}
            </span>
          ) : (
            <span className="text-xs truncate flex-1">
              {instance.currentStepId ? (
                activeTaskId ? (
                  <span
                    role="link"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      window.location.href = `/tasks/${activeTaskId}`;
                    }}
                    className="inline-flex items-center gap-1 bg-muted/50 rounded px-1.5 py-0.5 text-xs font-medium cursor-pointer hover:bg-muted transition-colors"
                  >
                    {toHumanLabel(instance.currentStepId)}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </span>
                ) : (
                  <span className="inline-flex bg-muted/50 rounded px-1.5 py-0.5 text-xs font-medium">
                    {toHumanLabel(instance.currentStepId)}
                  </span>
                )
              ) : 'Starting...'}
            </span>
          )}
        </>
      )}
      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0 w-[48px] text-right" title={fullTimeAgo}>
        {timeAgo}
      </span>
      <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </Link>
  );
}
