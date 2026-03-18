'use client';

import * as React from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { ChevronRight } from 'lucide-react';
import type { ProcessInstance } from '@mediforce/platform-core';
import { StatusDot } from '@/components/ui/status-dot';

function toHumanLabel(identifier: string): string {
  return identifier
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function StepBreadcrumb({
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
      <div className="flex items-center flex-1 min-w-0 overflow-hidden">
        <span className="text-xs text-green-600/70 dark:text-green-400/70 truncate">
          ✓ Completed ({steps.length} steps)
        </span>
      </div>
    );
  }

  if (instanceStatus === 'failed') {
    const failedAt = currentStepId ? toHumanLabel(currentStepId) : null;
    return (
      <div className="flex items-center flex-1 min-w-0 overflow-hidden">
        <span className="text-xs text-red-600/70 dark:text-red-400/70 truncate">
          {failedAt !== null ? `✗ Failed at ${failedAt}` : '✗ Failed'}
        </span>
      </div>
    );
  }

  const currentIndex = currentStepId !== null ? steps.indexOf(currentStepId) : -1;
  const completedSteps = currentIndex > 0 ? steps.slice(0, currentIndex) : [];
  const futureSteps = currentIndex >= 0 ? steps.slice(currentIndex + 1) : [];

  const parts: React.ReactNode[] = [];

  // Completed steps section
  if (completedSteps.length >= 3) {
    parts.push(
      <span key="completed-count" className="text-xs text-green-600/60 dark:text-green-400/60 shrink-0">
        ✓{completedSteps.length} steps
      </span>,
    );
    parts.push(<span key="sep-after-completed" className="text-muted-foreground/30 mx-0.5 shrink-0">→</span>);
  } else if (completedSteps.length > 0) {
    for (let i = 0; i < completedSteps.length; i++) {
      parts.push(
        <span key={`completed-${completedSteps[i]}`} className="text-xs text-green-600/60 dark:text-green-400/60 shrink-0">
          {toHumanLabel(completedSteps[i]!)}
        </span>,
      );
      parts.push(<span key={`sep-c${i}`} className="text-muted-foreground/30 mx-0.5 shrink-0">→</span>);
    }
  }

  // Current step
  if (currentIndex >= 0 && currentStepId !== null) {
    parts.push(
      <span
        key="current"
        className="text-xs font-medium bg-primary/10 text-primary rounded px-1.5 py-0.5 shrink-0"
      >
        {toHumanLabel(currentStepId)}
      </span>,
    );
  } else if (currentStepId === null) {
    parts.push(
      <span
        key="current-starting"
        className="text-xs font-medium bg-primary/10 text-primary rounded px-1.5 py-0.5 shrink-0"
      >
        Starting...
      </span>,
    );
  }

  // Future steps section
  if (futureSteps.length > 0 && futureSteps.length <= 2) {
    for (let i = 0; i < futureSteps.length; i++) {
      parts.push(<span key={`sep-f${i}`} className="text-muted-foreground/30 mx-0.5 shrink-0">→</span>);
      parts.push(
        <span key={`future-${futureSteps[i]}`} className="text-xs text-muted-foreground/40 shrink-0">
          {toHumanLabel(futureSteps[i]!)}
        </span>,
      );
    }
  } else if (futureSteps.length >= 3) {
    parts.push(<span key="sep-before-future" className="text-muted-foreground/30 mx-0.5 shrink-0">→</span>);
    parts.push(
      <span key="future-first" className="text-xs text-muted-foreground/40 shrink-0">
        {toHumanLabel(futureSteps[0]!)}
      </span>,
    );
    parts.push(<span key="sep-more" className="text-muted-foreground/30 mx-0.5 shrink-0">→</span>);
    parts.push(
      <span key="future-more" className="text-xs text-muted-foreground/40 shrink-0">
        +{futureSteps.length - 1}
      </span>,
    );
  }

  return (
    <div className="flex items-center flex-1 min-w-0 overflow-hidden">
      <div className="flex items-center flex-nowrap overflow-hidden">
        {parts}
      </div>
    </div>
  );
}

export function ProcessInstanceRow({ instance, showProcess = false, steps }: { instance: ProcessInstance; showProcess?: boolean; steps?: string[] }) {
  const shortHash = `#${instance.id.slice(0, 6)}`;
  const timeAgo = formatDistanceToNow(new Date(instance.createdAt), { addSuffix: true });
  const detailHref = `/processes/${encodeURIComponent(instance.definitionName)}/runs/${instance.id}`;

  return (
    <Link
      href={detailHref}
      className="group flex items-center gap-3 px-4 py-1.5 hover:bg-muted/50 transition-colors border-b border-border/40 last:border-b-0"
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
      <StepBreadcrumb
        steps={steps ?? []}
        currentStepId={instance.currentStepId}
        instanceStatus={instance.status}
      />
      <span className="text-xs text-muted-foreground tabular-nums shrink-0">
        {timeAgo}
      </span>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
    </Link>
  );
}
