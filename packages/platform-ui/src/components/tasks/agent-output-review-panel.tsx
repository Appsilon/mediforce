'use client';

import * as React from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { Bot, Code, FileText, Gauge } from 'lucide-react';
import type { AgentOutputData } from './task-utils';
import { cn } from '@/lib/utils';

interface AgentOutputReviewPanelProps {
  agentOutput: AgentOutputData;
  onContentLoaded?: (hasContent: boolean) => void;
}

export function AgentOutputReviewPanel({
  agentOutput,
  onContentLoaded,
}: AgentOutputReviewPanelProps) {
  const hasContent = agentOutput.result !== null && Object.keys(agentOutput.result).length > 0;

  React.useEffect(() => {
    onContentLoaded?.(hasContent);
  }, [hasContent, onContentLoaded]);

  if (!hasContent) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <p className="text-sm text-muted-foreground">
          No agent output to review.
        </p>
      </div>
    );
  }

  const confidencePct = agentOutput.confidence !== null
    ? Math.round(agentOutput.confidence * 100)
    : null;

  return (
    <div className="rounded-lg border">
      {/* Header with agent metadata */}
      <div className="px-4 pt-3 pb-0">
        <div className="flex items-center gap-2 mb-2">
          <Bot className="h-4 w-4 text-purple-500" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Agent Output for Review
          </span>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mb-2">
          {confidencePct !== null && (
            <span className="inline-flex items-center gap-1">
              <Gauge className="h-3 w-3" />
              Confidence: <span className={cn(
                'font-medium',
                confidencePct >= 80 ? 'text-green-600 dark:text-green-400' :
                confidencePct >= 50 ? 'text-amber-600 dark:text-amber-400' :
                'text-red-600 dark:text-red-400'
              )}>{confidencePct}%</span>
            </span>
          )}
          {agentOutput.model && (
            <span>Model: <span className="font-mono">{agentOutput.model}</span></span>
          )}
          {agentOutput.duration_ms !== null && (
            <span>Duration: {formatDuration(agentOutput.duration_ms)}</span>
          )}
        </div>
        {agentOutput.reasoning && (
          <p className="text-sm text-muted-foreground mb-2">{agentOutput.reasoning}</p>
        )}
      </div>

      <Tabs.Root defaultValue="summary">
        <Tabs.List className="flex gap-1 border-b px-4">
          {[
            { value: 'summary', label: 'Extracted Data', icon: FileText },
            { value: 'full', label: 'Raw JSON', icon: Code },
          ].map(({ value, label, icon: Icon }) => (
            <Tabs.Trigger
              key={value}
              value={value}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium',
                'text-muted-foreground border-b-2 border-transparent -mb-px',
                'transition-colors',
                'data-[state=active]:border-primary data-[state=active]:text-primary',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="summary" className="p-4">
          <MetadataSummary result={agentOutput.result!} />
        </Tabs.Content>

        <Tabs.Content value="full" className="p-4">
          <pre className="rounded-md bg-muted p-4 text-xs overflow-auto max-h-[600px] whitespace-pre-wrap break-words">
            {JSON.stringify(agentOutput.result, null, 2)}
          </pre>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

function MetadataSummary({ result }: { result: Record<string, unknown> }) {
  const entries = Object.entries(result);

  return (
    <div className="space-y-4">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            {formatKey(key)}
          </dt>
          <dd className="text-sm">
            <MetadataValue value={value} />
          </dd>
        </div>
      ))}
    </div>
  );
}

function MetadataValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground italic">-</span>;
  }

  if (typeof value === 'string') {
    return <span className="whitespace-pre-wrap break-words">{value}</span>;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span className="font-mono text-xs">{String(value)}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground italic">None</span>;

    // Simple string arrays render as comma-separated
    if (value.every((item) => typeof item === 'string')) {
      return (
        <div className="flex flex-wrap gap-1.5">
          {value.map((item, index) => (
            <span key={index} className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs">
              {item as string}
            </span>
          ))}
        </div>
      );
    }

    // Object arrays render as a list of cards
    return (
      <div className="space-y-2">
        {value.map((item, index) => (
          <div key={index} className="rounded-md border bg-muted/30 p-3">
            {typeof item === 'object' && item !== null ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                {Object.entries(item as Record<string, unknown>).map(([subKey, subValue]) => (
                  <React.Fragment key={subKey}>
                    <dt className="text-muted-foreground font-medium">{formatKey(subKey)}</dt>
                    <dd className="font-mono break-words">
                      {subValue === null || subValue === undefined
                        ? '-'
                        : typeof subValue === 'object'
                        ? JSON.stringify(subValue)
                        : String(subValue)}
                    </dd>
                  </React.Fragment>
                ))}
              </dl>
            ) : (
              <span className="text-xs">{JSON.stringify(item)}</span>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (typeof value === 'object') {
    return (
      <div className="rounded-md border bg-muted/30 p-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {Object.entries(value as Record<string, unknown>).map(([subKey, subValue]) => (
            <React.Fragment key={subKey}>
              <dt className="text-muted-foreground font-medium">{formatKey(subKey)}</dt>
              <dd className="font-mono break-words">
                {subValue === null || subValue === undefined
                  ? '-'
                  : typeof subValue === 'object'
                  ? JSON.stringify(subValue)
                  : String(subValue)}
              </dd>
            </React.Fragment>
          ))}
        </dl>
      </div>
    );
  }

  return <span>{String(value)}</span>;
}

function formatKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}
