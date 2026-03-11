'use client';

import * as React from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { FileText, Code } from 'lucide-react';
import type { StepExecution } from '@mediforce/platform-core';
import { useSubcollection } from '@/hooks/use-process-instances';
import { cn } from '@/lib/utils';

interface TaskContextPanelProps {
  processInstanceId: string;
  stepId: string; // The human task's stepId — we need the PREVIOUS step's output
  onContentLoaded?: (hasContent: boolean) => void;
}

/**
 * Displays the previous step's output in two tabs: Summary and Full Output.
 * Reports content availability via onContentLoaded callback so the parent
 * can disable verdict buttons when no content exists to review.
 */
export function TaskContextPanel({
  processInstanceId,
  stepId,
  onContentLoaded,
}: TaskContextPanelProps) {
  const { data: executions, loading } = useSubcollection<StepExecution & { id: string }>(
    processInstanceId ? `processInstances/${processInstanceId}` : '',
    'stepExecutions',
  );

  // Find the most recent completed step execution that is NOT the current human step
  const previousStepOutput = React.useMemo(() => {
    if (!executions.length) return null;
    const completed = executions
      .filter((e) => e.stepId !== stepId && e.status === 'completed' && e.output)
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    return completed.length > 0 ? completed[completed.length - 1] : null;
  }, [executions, stepId]);

  const hasContent = previousStepOutput !== null && previousStepOutput.output !== null;

  // Notify parent about content availability
  React.useEffect(() => {
    onContentLoaded?.(hasContent);
  }, [hasContent, onContentLoaded]);

  if (loading) {
    return (
      <div className="rounded-lg border p-6">
        <div className="space-y-3">
          <div className="h-4 w-32 rounded bg-muted animate-pulse" />
          <div className="h-24 rounded bg-muted animate-pulse" />
        </div>
      </div>
    );
  }

  if (!hasContent) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Waiting for step output...
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Verdict buttons will be enabled once there is content to review.
        </p>
      </div>
    );
  }

  const output = previousStepOutput!.output!;
  const isObject = typeof output === 'object' && output !== null;

  return (
    <div className="rounded-lg border">
      <div className="px-4 pt-3 pb-0">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
          Previous Step Output
          <span className="ml-2 font-normal normal-case text-muted-foreground/70">
            ({previousStepOutput!.stepId})
          </span>
        </div>
      </div>
      <Tabs.Root defaultValue="summary">
        <Tabs.List className="flex gap-1 border-b px-4">
          {[
            { value: 'summary', label: 'Summary', icon: FileText },
            { value: 'full', label: 'Full Output', icon: Code },
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
          {isObject ? (
            <SummaryView output={output as Record<string, unknown>} />
          ) : (
            <pre className="text-sm whitespace-pre-wrap break-words">
              {String(output)}
            </pre>
          )}
        </Tabs.Content>

        <Tabs.Content value="full" className="p-4">
          <pre className="rounded-md bg-muted p-4 text-xs overflow-auto max-h-96 whitespace-pre-wrap break-words">
            {isObject ? JSON.stringify(output, null, 2) : String(output)}
          </pre>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

/** Renders top-level keys of the output as a definition list. */
function SummaryView({ output }: { output: Record<string, unknown> }) {
  const entries = Object.entries(output);
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No output data.</p>
    );
  }

  // Feature prominent fields at the top
  const prominentKeys = ['reasoning_summary', 'recommendation', 'summary', 'result'];
  const prominent = entries.filter(([k]) => prominentKeys.includes(k));
  const rest = entries.filter(([k]) => !prominentKeys.includes(k));

  return (
    <div className="space-y-4">
      {/* Featured fields */}
      {prominent.map(([key, value]) => (
        <div key={key} className="rounded-md bg-primary/5 border border-primary/10 p-3">
          <div className="text-xs font-medium text-primary uppercase tracking-wide mb-1">
            {formatKey(key)}
          </div>
          <div className="text-sm">
            <ValueDisplay value={value} />
          </div>
        </div>
      ))}

      {/* Remaining fields as definition list */}
      {rest.length > 0 && (
        <dl className="grid grid-cols-1 gap-3">
          {rest.map(([key, value]) => (
            <div key={key}>
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">
                {formatKey(key)}
              </dt>
              <dd className="text-sm">
                <ValueDisplay value={value} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** Format a camelCase or snake_case key into a human-readable label. */
function formatKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Render a value — strings as-is, arrays/objects as structured cards. */
function ValueDisplay({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground italic">null</span>;
  }

  if (typeof value === 'string') {
    // Detect stringified JSON and render it structured
    const trimmed = value.trim();
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed === 'object' && parsed !== null) {
          return <ValueDisplay value={parsed} />;
        }
      } catch {
        // Not valid JSON, fall through to plain string
      }
    }
    return <span className="whitespace-pre-wrap break-words">{value}</span>;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span className="font-mono text-xs">{String(value)}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground italic">[]</span>;

    // Simple string/number arrays as pills
    if (value.every((item) => typeof item === 'string' || typeof item === 'number')) {
      return (
        <div className="flex flex-wrap gap-1.5">
          {value.map((item, index) => (
            <span key={index} className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs">
              {String(item)}
            </span>
          ))}
        </div>
      );
    }

    // Object arrays as cards
    return (
      <div className="space-y-2">
        {value.map((item, index) => (
          <div key={index} className="rounded-md border bg-muted/30 p-3">
            {typeof item === 'object' && item !== null ? (
              <dl className="grid grid-cols-1 gap-y-2 text-xs">
                {Object.entries(item as Record<string, unknown>).map(([subKey, subValue]) => (
                  <div key={subKey}>
                    <dt className="text-muted-foreground font-medium mb-0.5">{formatKey(subKey)}</dt>
                    <dd className="break-words">
                      {subValue === null || subValue === undefined
                        ? <span className="text-muted-foreground italic">-</span>
                        : typeof subValue === 'object'
                        ? <ValueDisplay value={subValue} />
                        : <span className="whitespace-pre-wrap">{String(subValue)}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <span className="text-xs">{String(item)}</span>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <div className="rounded-md border bg-muted/30 p-3">
        <dl className="grid grid-cols-1 gap-y-2 text-xs">
          {entries.map(([subKey, subValue]) => (
            <div key={subKey}>
              <dt className="text-muted-foreground font-medium mb-0.5">{formatKey(subKey)}</dt>
              <dd className="break-words">
                {subValue === null || subValue === undefined
                  ? <span className="text-muted-foreground italic">-</span>
                  : typeof subValue === 'object'
                  ? <ValueDisplay value={subValue} />
                  : <span className="whitespace-pre-wrap">{String(subValue)}</span>}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  return <span>{String(value)}</span>;
}
