'use client';

import * as React from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import * as Tabs from '@radix-ui/react-tabs';
import { useTheme } from 'next-themes';
import { ChevronDown, Code, FileText, MonitorPlay } from 'lucide-react';
import type { StepExecution } from '@mediforce/platform-core';
import { useSubcollection } from '@/hooks/use-process-instances';
import { apiFetch } from '@/lib/api-fetch';
import { cn } from '@/lib/utils';
import { buildSrcdoc, isIframeResizeMessage } from './iframe-helpers';

interface TaskContextPanelProps {
  processInstanceId: string;
  stepId: string; // The human task's stepId — we need the PREVIOUS step's output
  onContentLoaded?: (hasContent: boolean) => void;
}

/**
 * Displays the previous step's output. When that step produced an HTML
 * report — either inline (`presentation` field) or as a written file
 * (`htmlReportPath` field) — the panel renders it inside a sandboxed
 * iframe under a "Report" tab and selects that tab by default. The
 * Summary and Full Output tabs remain available for the structured JSON.
 *
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

  const previousStep = previousStepOutput!;
  const output = previousStep.output!;
  const isObject = typeof output === 'object' && output !== null;

  return (
    <Collapsible.Root defaultOpen={false}>
      <div className="rounded-lg border">
        <Collapsible.Trigger className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Previous Step Output
            <span className="ml-2 font-normal normal-case text-muted-foreground/70">
              ({previousStep.stepId})
            </span>
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 data-[state=open]:rotate-180" />
        </Collapsible.Trigger>
        <Collapsible.Content>
          <PreviousStepOutputTabs
            output={isObject ? (output as Record<string, unknown>) : null}
            rawOutput={output}
            instanceId={processInstanceId}
            previousStepId={previousStep.stepId}
          />
        </Collapsible.Content>
      </div>
    </Collapsible.Root>
  );
}

interface PreviousStepOutputTabsProps {
  output: Record<string, unknown> | null;
  rawOutput: unknown;
  instanceId: string;
  previousStepId: string;
}

function PreviousStepOutputTabs({
  output,
  rawOutput,
  instanceId,
  previousStepId,
}: PreviousStepOutputTabsProps) {
  const inlinePresentation =
    output !== null && typeof output.presentation === 'string' && output.presentation.length > 0
      ? output.presentation
      : null;

  const htmlReportPath =
    output !== null && typeof output.htmlReportPath === 'string' && output.htmlReportPath.length > 0
      ? output.htmlReportPath
      : null;

  const reportMode: 'inline' | 'file' | null = inlinePresentation !== null
    ? 'inline'
    : htmlReportPath !== null
      ? 'file'
      : null;

  const [fetchedReport, setFetchedReport] = React.useState<string | null>(null);
  const [reportLoading, setReportLoading] = React.useState(false);
  const [reportError, setReportError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (reportMode !== 'file') return;
    let cancelled = false;
    setReportLoading(true);
    setReportError(null);
    setFetchedReport(null);
    apiFetch(
      `/api/agent-output-file?instanceId=${encodeURIComponent(instanceId)}&stepId=${encodeURIComponent(previousStepId)}&kind=presentation`,
    )
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.text();
      })
      .then((text) => {
        if (cancelled) return;
        setFetchedReport(text);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setReportError(err instanceof Error ? err.message : 'Failed to fetch report');
      })
      .finally(() => {
        if (cancelled) return;
        setReportLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reportMode, instanceId, previousStepId]);

  const presentationHtml = inlinePresentation ?? fetchedReport;
  const showReportTab = reportMode !== null;
  const defaultTab = showReportTab ? 'report' : 'summary';

  return (
    <Tabs.Root defaultValue={defaultTab}>
      <Tabs.List className="flex gap-1 border-b px-4">
        {[
          ...(showReportTab ? [{ value: 'report', label: 'Report', icon: MonitorPlay }] : []),
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

      {showReportTab && (
        <Tabs.Content value="report" className="p-4">
          <ReportPane
            html={presentationHtml}
            loading={reportLoading}
            error={reportError}
            result={output}
          />
        </Tabs.Content>
      )}

      <Tabs.Content value="summary" className="p-4">
        {output !== null ? (
          <SummaryView output={output} />
        ) : (
          <pre className="text-sm whitespace-pre-wrap break-words">
            {String(rawOutput)}
          </pre>
        )}
      </Tabs.Content>

      <Tabs.Content value="full" className="p-4">
        <pre className="rounded-md bg-muted p-4 text-xs overflow-auto max-h-96 whitespace-pre-wrap break-words">
          {output !== null ? JSON.stringify(output, null, 2) : String(rawOutput)}
        </pre>
      </Tabs.Content>
    </Tabs.Root>
  );
}

interface ReportPaneProps {
  html: string | null;
  loading: boolean;
  error: string | null;
  result: Record<string, unknown> | null;
}

function ReportPane({ html, loading, error, result }: ReportPaneProps) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = React.useState(300);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  // Listen for resize messages from the iframe
  React.useEffect(() => {
    if (html === null) return;
    const handler = (event: MessageEvent) => {
      if (
        isIframeResizeMessage(event.data) &&
        iframeRef.current &&
        event.source === iframeRef.current.contentWindow
      ) {
        setIframeHeight(event.data.height);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [html]);

  // Sync theme changes to iframe
  React.useEffect(() => {
    if (html === null) return;
    iframeRef.current?.contentWindow?.postMessage({ type: 'theme', dark: isDark }, '*');
  }, [isDark, html]);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-4 w-32 rounded bg-muted animate-pulse" />
        <div className="h-24 rounded bg-muted animate-pulse" />
      </div>
    );
  }

  if (error !== null && html === null) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
        Report file not available — see Summary tab.
      </div>
    );
  }

  if (html === null) {
    return (
      <div className="text-sm text-muted-foreground">
        No report content.
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      srcDoc={buildSrcdoc(html, result, isDark)}
      sandbox="allow-scripts"
      style={{ width: '100%', height: iframeHeight, border: 'none' }}
      title="Previous step report"
    />
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
