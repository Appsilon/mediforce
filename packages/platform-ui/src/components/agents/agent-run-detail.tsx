'use client';

import * as React from 'react';
import Link from 'next/link';
import { format, differenceInMilliseconds } from 'date-fns';
import * as Collapsible from '@radix-ui/react-collapsible';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import type { AgentRun, ProcessInstance } from '@mediforce/platform-core';
import { ConfidenceBadge } from './confidence-badge';
import { AutonomyBadge } from './autonomy-badge';
import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  running: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  escalated: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  timed_out: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  low_confidence: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  flagged: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
};

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
  badge,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <Collapsible.Root defaultOpen={defaultOpen} className="rounded-lg border">
      <Collapsible.Trigger className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
        <div className="flex items-center gap-3">
          <span className="font-medium text-sm">{title}</span>
          {badge}
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div className="border-t px-4 py-4">
          {children}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function CollapsibleItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Collapsible.Root>
      <Collapsible.Trigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1">
        <ChevronDown className="h-3 w-3 transition-transform data-[state=open]:rotate-180" />
        {label}
      </Collapsible.Trigger>
      <Collapsible.Content className="mt-1 mb-2">
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return 'still running';
  const ms = differenceInMilliseconds(new Date(end), new Date(start));
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Convert "supply-review" to "Supply Review" */
function formatStepName(stepId: string): string {
  return stepId
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Render a record as flat key-value table rows (primitives) + collapsible JSON (objects/arrays) */
function LightFormattedData({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  const flatEntries = entries.filter(
    ([, v]) => v === null || typeof v !== 'object',
  );
  const nestedEntries = entries.filter(
    ([, v]) => v !== null && typeof v === 'object',
  );

  return (
    <div className="space-y-3">
      {flatEntries.length > 0 && (
        <table className="w-full text-sm border-collapse">
          <tbody>
            {flatEntries.map(([key, value]) => (
              <tr key={key} className="border-b border-muted last:border-b-0">
                <td className="py-1.5 pr-4 font-medium text-muted-foreground text-xs whitespace-nowrap align-top">
                  {key}
                </td>
                <td className="py-1.5 text-xs font-mono text-foreground">
                  {String(value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {nestedEntries.map(([key, value]) => (
        <CollapsibleItem key={key} label={key}>
          <pre className="rounded bg-muted p-3 text-xs overflow-auto max-h-48">
            {JSON.stringify(value, null, 2)}
          </pre>
        </CollapsibleItem>
      ))}
    </div>
  );
}

export function AgentRunDetail({
  run,
  processInstance,
  inputData,
}: {
  run: AgentRun;
  processInstance?: ProcessInstance | null;
  inputData?: Record<string, unknown> | null;
}) {
  const { envelope } = run;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {/* Back */}
      <Link href="/agents" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" />
        Back to Agent Oversight
      </Link>

      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <h1 className="text-2xl font-headline font-semibold font-mono">{run.pluginId}</h1>
            <p className="text-sm text-muted-foreground">
              {processInstance?.definitionName ?? 'Unknown Workflow'}
            </p>
          </div>
          <span className={cn('shrink-0 mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-medium', STATUS_STYLES[run.status] ?? STATUS_STYLES.completed)}>
            {run.status.replace(/_/g, ' ')}
          </span>
        </div>

        {/* Metadata row */}
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1">Autonomy: <AutonomyBadge level={run.autonomyLevel} showLabel /></span>
          {run.executorType && <span>Executor: <span className="text-foreground font-medium">{run.executorType}</span></span>}
          {run.reviewerType && <span>Reviewer: <span className="text-foreground font-medium">{run.reviewerType}</span></span>}
          <span>Workflow: <Link href={`/workflows/${run.processInstanceId}`} className="text-primary hover:underline font-mono text-xs">{run.processInstanceId.slice(0, 12)}...</Link></span>
          <span>Step: <span className="text-foreground font-medium">{formatStepName(run.stepId)}</span></span>
          <span>Duration: <span className="text-foreground">{formatDuration(run.startedAt, run.completedAt)}</span></span>
          <span>Started: <span className="text-foreground">{format(new Date(run.startedAt), 'MMM d, yyyy HH:mm:ss')}</span></span>
          {envelope?.model && <span>Model: <span className="text-foreground font-mono text-xs">{envelope.model}</span></span>}
        </div>

        {/* Confidence -- always visible in header */}
        {envelope && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Confidence:</span>
            <ConfidenceBadge confidence={envelope.confidence} showLabel />
          </div>
        )}

        {run.fallbackReason && (
          <div className="rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
            Fallback reason: {run.fallbackReason}
          </div>
        )}
      </div>

      {/* Collapsible sections */}
      <div className="space-y-3">
        {/* Input section */}
        <CollapsibleSection title="Input (Previous Step Output)" defaultOpen={false}>
          <div className="space-y-3 text-sm">
            {inputData ? (
              <LightFormattedData data={inputData} />
            ) : (
              <p className="text-xs text-muted-foreground italic">
                No input data — this was the first step or input is unavailable.
              </p>
            )}
            {envelope?.annotations && envelope.annotations.length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">Annotations</div>
                <div className="space-y-1">
                  {envelope.annotations.map((annotation, i) => (
                    <CollapsibleItem key={i} label={`Annotation ${i + 1}`}>
                      <pre className="rounded bg-muted p-3 text-xs overflow-auto max-h-32">
                        {JSON.stringify(annotation, null, 2)}
                      </pre>
                    </CollapsibleItem>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CollapsibleSection>

        {/* Reasoning section */}
        <CollapsibleSection
          title="Reasoning"
          defaultOpen={true}
          badge={envelope ? <ConfidenceBadge confidence={envelope.confidence} /> : undefined}
        >
          {envelope?.reasoning_summary ? (
            <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
              {envelope.reasoning_summary}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">No reasoning trace available</p>
          )}
        </CollapsibleSection>

        {/* Output section */}
        <CollapsibleSection title="Output" defaultOpen={true}>
          {envelope?.result ? (
            <LightFormattedData data={envelope.result} />
          ) : (
            <p className="text-xs text-muted-foreground italic">
              {run.autonomyLevel === 'L0' || run.autonomyLevel === 'L1'
                ? `No structured output — ${run.autonomyLevel} agents are annotation-only`
                : 'No output produced'}
            </p>
          )}
        </CollapsibleSection>
      </div>
    </div>
  );
}
