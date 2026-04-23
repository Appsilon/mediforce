'use client';

import * as React from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { useTheme } from 'next-themes';
import { AlertTriangle, Bot, Code, ExternalLink, FileText, Gauge, GitBranch, Loader2, MonitorPlay } from 'lucide-react';
import type { AgentOutputData } from './task-utils';
import { formatStepName } from './task-utils';
import { apiFetch } from '@/lib/api-fetch';
import { cn } from '@/lib/utils';

interface AgentOutputReviewPanelProps {
  agentOutput: AgentOutputData;
  stepId?: string;
  onContentLoaded?: (hasContent: boolean) => void;
}

/** Build a self-contained HTML document for the sandboxed iframe. */
function buildSrcdoc(presentation: string, result: Record<string, unknown> | null, isDark: boolean): string {
  // Escape closing script tags in data to prevent XSS breakout
  const safeData = JSON.stringify(result ?? {}).replace(/<\//g, '<\\/');
  return `<!DOCTYPE html>
<html class="${isDark ? 'dark' : ''}">
<head>
<meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<style type="text/tailwindcss">
@theme {
  --color-surface: #ffffff;
  --color-surface-dark: #0f1117;
  --color-text: #1a1a2e;
  --color-text-dark: #e2e4e9;
  --color-muted: #6b7280;
  --color-muted-dark: #9ca3af;
  --color-border: #e5e7eb;
  --color-border-dark: #2d2f36;
}
body {
  margin: 0;
  padding: 1rem;
  background: var(--color-surface);
  color: var(--color-text);
}
.dark body {
  background: var(--color-surface-dark);
  color: var(--color-text-dark);
}
</style>
<script>window.__data__ = ${safeData};</script>
</head>
<body>
${presentation}
<script>
const ro = new ResizeObserver(() => {
  window.parent.postMessage({ type: 'resize', height: document.body.scrollHeight }, '*');
});
ro.observe(document.body);
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'theme') {
    document.documentElement.classList.toggle('dark', e.data.dark);
  }
});
</script>
</body>
</html>`;
}

/** Try to extract an output_file path from the result's `raw` field. */
function extractOutputFilePath(result: Record<string, unknown>): string | null {
  const raw = result.raw;
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.output_file === 'string') return parsed.output_file;
  } catch {
    // not JSON
  }
  return null;
}

export function AgentOutputReviewPanel({
  agentOutput,
  stepId,
  onContentLoaded,
}: AgentOutputReviewPanelProps) {
  const hasPresentation = typeof agentOutput.presentation === 'string' && agentOutput.presentation.length > 0;
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = React.useState(300);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  React.useEffect(() => {
    if (!hasPresentation) return;
    const handler = (event: MessageEvent) => {
      if (
        event.data &&
        typeof event.data === 'object' &&
        event.data.type === 'resize' &&
        typeof event.data.height === 'number' &&
        iframeRef.current &&
        event.source === iframeRef.current.contentWindow
      ) {
        setIframeHeight(event.data.height);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [hasPresentation]);

  // Sync theme changes to iframe
  React.useEffect(() => {
    if (!hasPresentation) return;
    iframeRef.current?.contentWindow?.postMessage({ type: 'theme', dark: isDark }, '*');
  }, [isDark, hasPresentation]);

  const hasContent = agentOutput.result !== null && Object.keys(agentOutput.result).length > 0;

  const outputFilePath = React.useMemo(
    () => (agentOutput.result ? extractOutputFilePath(agentOutput.result) : null),
    [agentOutput.result],
  );

  const [fileContent, setFileContent] = React.useState<string | null>(null);
  const [fileLoading, setFileLoading] = React.useState(false);
  const [fileError, setFileError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!outputFilePath) return;
    setFileLoading(true);
    apiFetch(`/api/agent-output-file?path=${encodeURIComponent(outputFilePath)}`)
      .then((res) => res.json() as Promise<{ content?: string; error?: string }>)
      .then((data) => {
        if (data.error && !data.content) {
          setFileError(data.error);
        } else if (data.content) {
          setFileContent(data.content);
        }
      })
      .catch((err: unknown) => {
        setFileError(err instanceof Error ? err.message : 'Failed to fetch file');
      })
      .finally(() => setFileLoading(false));
  }, [outputFilePath]);

  // Content is available if we have result metadata or file content
  const contentReady = hasContent || fileContent !== null;

  React.useEffect(() => {
    onContentLoaded?.(contentReady);
  }, [contentReady, onContentLoaded]);

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

  const hasFileTab = fileContent !== null || fileLoading || outputFilePath !== null;
  const hasGitTab = agentOutput.gitMetadata !== null;
  const defaultTab = hasPresentation ? 'presentation' : hasGitTab ? 'git' : hasFileTab ? 'content' : 'summary';

  return (
    <div className="rounded-lg border">
      {/* Header with agent metadata */}
      <div className="px-4 pt-3 pb-0">
        <div className="flex items-center gap-2 mb-2">
          <Bot className="h-4 w-4 text-purple-500" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Agent Output for Review
          </span>
          {stepId && (
            <span className="text-xs font-medium text-foreground">
              — {formatStepName(stepId)}
            </span>
          )}
          {agentOutput.escalationReason !== null && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
              title={`Agent escalated to human because of ${agentOutput.escalationReason.replace(/_/g, ' ')}. Review the recommendation and approve or request revision.`}
            >
              <AlertTriangle className="h-3 w-3" />
              Escalated: {formatEscalationReason(agentOutput.escalationReason)}
              {agentOutput.escalationReason === 'low_confidence' && confidencePct !== null && ` (${confidencePct}%)`}
            </span>
          )}
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
          {agentOutput.gitMetadata !== null && (
            <>
              <span className="inline-flex items-center gap-1">
                <GitBranch className="h-3 w-3" />
                <span className="font-mono">{agentOutput.gitMetadata.branch}</span>
              </span>
              <a
                href={`${agentOutput.gitMetadata.repoUrl}/commit/${agentOutput.gitMetadata.commitSha}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono hover:text-foreground transition-colors"
              >
                {agentOutput.gitMetadata.commitSha.slice(0, 7)}
                <ExternalLink className="h-3 w-3" />
              </a>
            </>
          )}
        </div>
        {agentOutput.confidence_rationale && (
          <p className="text-xs text-muted-foreground italic mb-2">{agentOutput.confidence_rationale}</p>
        )}
        {agentOutput.reasoning && (
          <p className="text-sm text-muted-foreground mb-2">{agentOutput.reasoning}</p>
        )}
      </div>

      <Tabs.Root defaultValue={defaultTab}>
        <Tabs.List className="flex gap-1 border-b px-4">
          {[
            ...(hasPresentation ? [{ value: 'presentation', label: 'Presentation', icon: MonitorPlay }] : []),
            ...(hasFileTab ? [{ value: 'content', label: 'Content', icon: FileText }] : []),
            ...(hasGitTab ? [{ value: 'git', label: 'Git', icon: GitBranch }] : []),
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

        {hasPresentation && (
          <Tabs.Content value="presentation" className="p-4">
            <iframe
              ref={iframeRef}
              srcDoc={buildSrcdoc(agentOutput.presentation!, agentOutput.result, isDark)}
              sandbox="allow-scripts"
              style={{ width: '100%', height: iframeHeight, border: 'none' }}
              title="Agent presentation"
            />
          </Tabs.Content>
        )}

        {hasFileTab && (
          <Tabs.Content value="content" className="p-4">
            {fileLoading && (
              <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading content...</span>
              </div>
            )}
            {fileError && (
              <div className="text-sm text-amber-600 dark:text-amber-400 py-4">
                {fileError}
              </div>
            )}
            {fileContent && (
              <div className="prose prose-sm dark:prose-invert max-w-none overflow-auto max-h-[600px]">
                <MarkdownContent content={fileContent} />
              </div>
            )}
          </Tabs.Content>
        )}

        {hasGitTab && agentOutput.gitMetadata !== null && (
          <Tabs.Content value="git" className="p-4 space-y-4">
            <a
              href={`${agentOutput.gitMetadata.repoUrl}/compare/main...${agentOutput.gitMetadata.branch}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              View diff on GitHub
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            {agentOutput.gitMetadata.changedFiles.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Changed Files
                </h4>
                <ul className="space-y-1">
                  {agentOutput.gitMetadata.changedFiles.map((file) => (
                    <li key={file}>
                      <a
                        href={`${agentOutput.gitMetadata!.repoUrl}/blob/${agentOutput.gitMetadata!.commitSha}/${file}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-mono text-primary hover:underline"
                      >
                        {file}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Tabs.Content>
        )}

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

/** Simple markdown renderer — renders headings, bold, lists, tables, and paragraphs. */
function MarkdownContent({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const Tag = `h${level}` as keyof React.JSX.IntrinsicElements;
      elements.push(<Tag key={index}>{text}</Tag>);
      index++;
      continue;
    }

    // Table: detect lines starting with |
    if (line.trim().startsWith('|')) {
      const tableLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        tableLines.push(lines[index]);
        index++;
      }
      elements.push(<MarkdownTable key={index} lines={tableLines} />);
      continue;
    }

    // Unordered list items
    if (line.match(/^\s*[-*]\s+/)) {
      const listItems: string[] = [];
      while (index < lines.length && lines[index].match(/^\s*[-*]\s+/)) {
        listItems.push(lines[index].replace(/^\s*[-*]\s+/, ''));
        index++;
      }
      elements.push(
        <ul key={index}>
          {listItems.map((item, itemIndex) => (
            <li key={itemIndex}><InlineMarkdown text={item} /></li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list items
    if (line.match(/^\s*\d+\.\s+/)) {
      const listItems: string[] = [];
      while (index < lines.length && lines[index].match(/^\s*\d+\.\s+/)) {
        listItems.push(lines[index].replace(/^\s*\d+\.\s+/, ''));
        index++;
      }
      elements.push(
        <ol key={index}>
          {listItems.map((item, itemIndex) => (
            <li key={itemIndex}><InlineMarkdown text={item} /></li>
          ))}
        </ol>,
      );
      continue;
    }

    // Horizontal rule
    if (line.match(/^---+$/)) {
      elements.push(<hr key={index} />);
      index++;
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      index++;
      continue;
    }

    // Paragraph — collect consecutive non-empty, non-special lines
    const paraLines: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() !== '' &&
      !lines[index].match(/^#{1,6}\s/) &&
      !lines[index].trim().startsWith('|') &&
      !lines[index].match(/^\s*[-*]\s+/) &&
      !lines[index].match(/^\s*\d+\.\s+/) &&
      !lines[index].match(/^---+$/)
    ) {
      paraLines.push(lines[index]);
      index++;
    }
    if (paraLines.length > 0) {
      elements.push(
        <p key={index}>
          <InlineMarkdown text={paraLines.join(' ')} />
        </p>,
      );
    }
  }

  return <>{elements}</>;
}

function InlineMarkdown({ text }: { text: string }) {
  // Bold: **text**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, partIndex) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={partIndex}>{part.slice(2, -2)}</strong>;
        }
        return <React.Fragment key={partIndex}>{part}</React.Fragment>;
      })}
    </>
  );
}

function MarkdownTable({ lines }: { lines: string[] }) {
  if (lines.length < 2) return null;

  const parseRow = (line: string): string[] =>
    line.split('|').slice(1, -1).map((cell) => cell.trim());

  const headers = parseRow(lines[0]);
  // Skip separator line (index 1)
  const bodyLines = lines.slice(2);

  return (
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>
            {headers.map((header, headerIndex) => (
              <th key={headerIndex}><InlineMarkdown text={header} /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyLines.map((line, rowIndex) => {
            const cells = parseRow(line);
            return (
              <tr key={rowIndex}>
                {cells.map((cell, cellIndex) => (
                  <td key={cellIndex}><InlineMarkdown text={cell} /></td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
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
    // Detect stringified JSON and render it structured
    const trimmed = value.trim();
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed === 'object' && parsed !== null) {
          return <MetadataValue value={parsed} />;
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
              <dl className="grid grid-cols-1 gap-y-2 text-xs">
                {Object.entries(item as Record<string, unknown>).map(([subKey, subValue]) => (
                  <div key={subKey}>
                    <dt className="text-muted-foreground font-medium mb-0.5">{formatKey(subKey)}</dt>
                    <dd className="break-words">
                      <MetadataValue value={subValue} />
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <span className="text-xs"><MetadataValue value={item} /></span>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (typeof value === 'object') {
    return (
      <div className="rounded-md border bg-muted/30 p-3">
        <dl className="grid grid-cols-1 gap-y-2 text-xs">
          {Object.entries(value as Record<string, unknown>).map(([subKey, subValue]) => (
            <div key={subKey}>
              <dt className="text-muted-foreground font-medium mb-0.5">{formatKey(subKey)}</dt>
              <dd className="break-words">
                <MetadataValue value={subValue} />
              </dd>
            </div>
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

function formatEscalationReason(reason: 'low_confidence' | 'timeout' | 'error' | 'iterations_limit'): string {
  switch (reason) {
    case 'low_confidence': return 'low confidence';
    case 'timeout': return 'timeout';
    case 'error': return 'error';
    case 'iterations_limit': return 'iterations limit reached';
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}
