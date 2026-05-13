'use client';

import * as React from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import * as Collapsible from '@radix-ui/react-collapsible';
import { useTheme } from 'next-themes';
import {
  ChevronDown,
  Clock,
  Code,
  DollarSign,
  ExternalLink,
  FileText,
  Gauge,
  Loader2,
  MonitorPlay,
} from 'lucide-react';
import type { AgentOutputData } from '@/components/tasks/task-utils';
import { buildSrcdoc, clampIframeHeight, isIframeResizeMessage } from '@/components/tasks/iframe-helpers';
import { apiFetch } from '@/lib/api-fetch';
import { formatCostUsd, formatDuration } from '@/lib/format';
import { cn, isBrowsableRepoUrl } from '@/lib/utils';

interface AgentOutputDisplayProps {
  agentOutput: AgentOutputData;
  instanceId: string;
  onContentLoaded?: (hasContent: boolean) => void;
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

/**
 * Full agent output view: metrics header, generated files, then a tabbed pane
 * (presentation iframe, fetched output file content, extracted-data summary,
 * raw JSON). Shared between the human-task review wrapper and the workflow
 * step detail page.
 */
export function AgentOutputDisplay({
  agentOutput,
  instanceId,
  onContentLoaded,
}: AgentOutputDisplayProps) {
  const hasPresentation = typeof agentOutput.presentation === 'string' && agentOutput.presentation.length > 0;
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = React.useState(300);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  React.useEffect(() => {
    if (!hasPresentation) return;
    const handler = (event: MessageEvent) => {
      if (
        isIframeResizeMessage(event.data) &&
        iframeRef.current &&
        event.source === iframeRef.current.contentWindow
      ) {
        setIframeHeight((prev) => {
          const next = clampIframeHeight(event.data.height);
          return next > 0 ? next : prev;
        });
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
    apiFetch(`/api/agent-output-file?path=${encodeURIComponent(outputFilePath)}&instanceId=${encodeURIComponent(instanceId)}`)
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
  }, [outputFilePath, instanceId]);

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

  const hasFileTab = fileContent !== null || fileLoading || outputFilePath !== null;
  const defaultTab = hasPresentation ? 'presentation' : hasFileTab ? 'content' : 'summary';

  return (
    <div>
      <MetricsHeader agentOutput={agentOutput} />
      {agentOutput.gitMetadata && agentOutput.gitMetadata.changedFiles.length > 0 && (
        <GeneratedFiles git={agentOutput.gitMetadata} />
      )}

      <Tabs.Root defaultValue={defaultTab}>
        <Tabs.List className="flex gap-1 border-b px-4">
          {[
            ...(hasPresentation ? [{ value: 'presentation', label: 'Presentation', icon: MonitorPlay }] : []),
            ...(hasFileTab ? [{ value: 'content', label: 'Content', icon: FileText }] : []),
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

// ── Metrics header ──────────────────────────────────────────────────────────

function MetricsHeader({ agentOutput }: { agentOutput: AgentOutputData }) {
  const confidencePct = agentOutput.confidence !== null
    ? Math.round(agentOutput.confidence * 100)
    : null;

  const hasAnyMetric =
    confidencePct !== null ||
    agentOutput.model !== null ||
    agentOutput.duration_ms !== null ||
    agentOutput.estimatedCostUsd !== null ||
    agentOutput.tokenUsage !== null;

  if (!hasAnyMetric && !agentOutput.reasoning && !agentOutput.confidence_rationale) {
    return null;
  }

  return (
    <div className="px-4 pt-3 pb-2 space-y-1.5 border-b">
      {hasAnyMetric && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {confidencePct !== null && (
            <span className="inline-flex items-center gap-1">
              <Gauge className="h-3 w-3" />
              <span>Confidence:</span>
              <span className={cn(
                'font-medium',
                confidencePct >= 80 ? 'text-green-600 dark:text-green-400' :
                confidencePct >= 50 ? 'text-amber-600 dark:text-amber-400' :
                'text-red-600 dark:text-red-400',
              )}>{confidencePct}%</span>
            </span>
          )}
          {agentOutput.model && (
            <span className="inline-flex items-center gap-1">
              Model: <span className="font-mono">{agentOutput.model}</span>
            </span>
          )}
          {agentOutput.duration_ms !== null && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDuration(agentOutput.duration_ms)}
            </span>
          )}
          {agentOutput.estimatedCostUsd !== null && (
            <span className="inline-flex items-center gap-1">
              <DollarSign className="h-3 w-3" />
              <span className="font-medium">{formatCostUsd(agentOutput.estimatedCostUsd)}</span>
            </span>
          )}
          {agentOutput.tokenUsage && (
            <span className="inline-flex items-center gap-1">
              <span>{agentOutput.tokenUsage.inputTokens.toLocaleString()}</span>
              <span>/</span>
              <span>{agentOutput.tokenUsage.outputTokens.toLocaleString()} tokens</span>
            </span>
          )}
        </div>
      )}
      {agentOutput.reasoning && (
        <p className="text-xs text-muted-foreground italic line-clamp-2">{agentOutput.reasoning}</p>
      )}
      {agentOutput.confidence_rationale && (
        <p className="text-xs text-muted-foreground italic">{agentOutput.confidence_rationale}</p>
      )}
    </div>
  );
}

// ── Generated files (git changedFiles) ──────────────────────────────────────

function GeneratedFiles({
  git,
}: {
  git: NonNullable<AgentOutputData['gitMetadata']>;
}) {
  const browsable = isBrowsableRepoUrl(git.repoUrl);
  const files = git.changedFiles;
  const collapsedByDefault = files.length > 5;
  const [open, setOpen] = React.useState(!collapsedByDefault);

  return (
    <div className="px-4 py-2 border-b">
      <Collapsible.Root open={open} onOpenChange={setOpen}>
        <Collapsible.Trigger className="flex w-full items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors">
          <ChevronDown className={cn('h-3 w-3 transition-transform', !open && '-rotate-90')} />
          <FileText className="h-3 w-3" />
          Generated Files
          <span className="normal-case font-normal text-muted-foreground/70">({files.length})</span>
          {browsable && (
            <a
              href={`${git.repoUrl}/commit/${git.commitSha}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="ml-2 inline-flex items-center gap-1 font-mono text-[11px] hover:text-foreground transition-colors"
            >
              {git.commitSha.slice(0, 7)}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </Collapsible.Trigger>
        <Collapsible.Content>
          <ul className="mt-1.5 space-y-0.5">
            {files.map((file) => (
              <li key={file}>
                {browsable ? (
                  <a
                    href={`${git.repoUrl}/blob/${git.commitSha}/${file}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-mono text-primary hover:underline"
                  >
                    {file}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-mono text-muted-foreground">
                    {file}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  );
}

// ── Markdown rendering ──────────────────────────────────────────────────────

/** Simple markdown renderer — renders headings, bold, lists, tables, and paragraphs. */
export function MarkdownContent({ content }: { content: string }) {
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
          {paraLines.map((line, lineIdx) => (
            <React.Fragment key={lineIdx}>
              {lineIdx > 0 && <br />}
              <InlineMarkdown text={line} />
            </React.Fragment>
          ))}
        </p>,
      );
    }
  }

  return <>{elements}</>;
}

function InlineMarkdown({ text }: { text: string }) {
  // Tokenize: **bold**, `code`, https://url. Order matters — process longer/wrapped tokens first.
  const tokenPattern = /(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)]+)/g;
  const parts = text.split(tokenPattern);
  return (
    <>
      {parts.map((part, partIndex) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={partIndex}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
          return (
            <code key={partIndex} className="rounded bg-muted px-1 py-0.5 text-[0.85em] font-mono">
              {part.slice(1, -1)}
            </code>
          );
        }
        if (/^https?:\/\//.test(part)) {
          return (
            <a
              key={partIndex}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline break-all"
            >
              {part}
            </a>
          );
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

// ── Extracted Data summary ──────────────────────────────────────────────────

type EntryKind = 'object-array' | 'short' | 'markdown' | 'yaml' | 'long-text';

const MARKDOWN_KEY_PATTERN = /^pr[-_ ]?body$|^body$|^markdown$|^notes$|^description$/i;
const YAML_KEY_PATTERN = /_yaml$|_json$/i;
const LONG_TEXT_CHAR_THRESHOLD = 200;
const SHORT_STRING_CHAR_THRESHOLD = 80;

function looksLikeMarkdown(value: string): boolean {
  return (
    value.includes('\n\n') &&
    (
      /(^|\n)#{1,6}\s/.test(value) ||
      /\*\*[^*]+\*\*/.test(value) ||
      /(^|\n)\s*-\s\[[ x]\]\s/.test(value) ||
      /^\s*#\s/.test(value)
    )
  );
}

function looksLikeYaml(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith('---')) return true;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return true;
  // YAML list of objects: "- key:" on first non-empty line
  return /^- \w+:/.test(trimmed);
}

function classifyEntry(key: string, value: unknown): EntryKind {
  if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'object' && item !== null && !Array.isArray(item))) {
    return 'object-array';
  }
  if (typeof value === 'string') {
    if (YAML_KEY_PATTERN.test(key) || looksLikeYaml(value)) {
      if (value.length > SHORT_STRING_CHAR_THRESHOLD || value.includes('\n')) return 'yaml';
    }
    if (MARKDOWN_KEY_PATTERN.test(key) && value.length > SHORT_STRING_CHAR_THRESHOLD) return 'markdown';
    if (looksLikeMarkdown(value)) return 'markdown';
    if (value.length > LONG_TEXT_CHAR_THRESHOLD || value.includes('\n')) return 'long-text';
  }
  return 'short';
}

const ENTRY_KIND_ORDER: Record<EntryKind, number> = {
  'object-array': 0,
  'short': 1,
  'markdown': 2,
  'yaml': 3,
  'long-text': 4,
};

interface ClassifiedEntry {
  key: string;
  value: unknown;
  kind: EntryKind;
}

function MetadataSummary({ result }: { result: Record<string, unknown> }) {
  const classified = React.useMemo<ClassifiedEntry[]>(
    () =>
      Object.entries(result)
        .filter(([, value]) => !isEmptyValue(value))
        .map(([key, value]) => ({ key, value, kind: classifyEntry(key, value) }))
        .sort((a, b) => ENTRY_KIND_ORDER[a.kind] - ENTRY_KIND_ORDER[b.kind]),
    [result],
  );

  const shortEntries = classified.filter((e) => e.kind === 'short');
  const otherEntries = classified.filter((e) => e.kind !== 'short');

  return (
    <div className="space-y-4">
      {otherEntries
        .filter((entry) => entry.kind === 'object-array')
        .map(({ key, value }) => (
          <ObjectArrayBlock key={key} entryKey={key} value={value as Record<string, unknown>[]} />
        ))}

      {shortEntries.length > 0 && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          {shortEntries.map(({ key, value }) => (
            <div key={key}>
              <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">
                {formatKey(key)}
              </dt>
              <dd className="text-sm">
                <MetadataValue value={value} />
              </dd>
            </div>
          ))}
        </dl>
      )}

      {otherEntries
        .filter((entry) => entry.kind === 'markdown')
        .map(({ key, value }) => (
          <MarkdownBlock key={key} entryKey={key} value={value as string} />
        ))}

      {otherEntries
        .filter((entry) => entry.kind === 'yaml')
        .map(({ key, value }) => (
          <CodeBlock key={key} entryKey={key} value={value as string} />
        ))}

      {otherEntries
        .filter((entry) => entry.kind === 'long-text')
        .map(({ key, value }) => (
          <LongTextBlock key={key} entryKey={key} value={value as string} />
        ))}
    </div>
  );
}

function ObjectArrayBlock({ entryKey, value }: { entryKey: string; value: Record<string, unknown>[] }) {
  // Detect if this looks like a list of rules (Linear-style card layout).
  const allRuleLike = value.every((item) => isRuleLike(item));

  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
        {formatKey(entryKey)} <span className="normal-case font-normal text-muted-foreground/70">({value.length})</span>
      </dt>
      <dd className="text-sm">
        <div className="space-y-2">
          {value.map((item, index) =>
            allRuleLike ? (
              <RuleCard key={index} item={item} />
            ) : (
              <ObjectCard key={index} item={item} />
            ),
          )}
        </div>
      </dd>
    </div>
  );
}

/** A rule-like entry has both `message` and at least one of `id`/`severity`. */
function isRuleLike(item: Record<string, unknown>): boolean {
  const hasMessage = typeof item.message === 'string' && item.message.length > 0;
  const hasIdOrSeverity = typeof item.id === 'string' || typeof item.severity === 'string';
  return hasMessage && hasIdOrSeverity;
}

const RULE_PRIMARY_KEYS = new Set(['id', 'domain', 'severity', 'message', 'variable', 'check']);

interface SeverityStyle {
  label: string;
  className: string;
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim().length === 0) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

function severityStyle(value: string): SeverityStyle {
  const normalized = value.toLowerCase().trim();
  if (/(critical|fatal|error)/.test(normalized)) {
    return { label: value, className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' };
  }
  if (/(major|high)/.test(normalized)) {
    return { label: value, className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' };
  }
  if (/(warn|warning|medium|moderate)/.test(normalized)) {
    return { label: value, className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' };
  }
  if (/(minor|low|info)/.test(normalized)) {
    return { label: value, className: 'bg-muted text-muted-foreground' };
  }
  return { label: value, className: 'bg-muted text-muted-foreground' };
}

function RuleCard({ item }: { item: Record<string, unknown> }) {
  const id = typeof item.id === 'string' ? item.id : null;
  const domain = typeof item.domain === 'string' ? item.domain : null;
  const severity = typeof item.severity === 'string' ? item.severity : null;
  const message = typeof item.message === 'string' ? item.message : null;
  const variable = typeof item.variable === 'string' ? item.variable : null;
  const check = typeof item.check === 'string' ? item.check : null;

  const otherEntries = Object.entries(item).filter(
    ([key, value]) => !RULE_PRIMARY_KEYS.has(key) && !isEmptyValue(value),
  );

  const meta: React.ReactNode[] = [];
  if (variable) meta.push(<span key="variable" className="font-mono">{variable}</span>);
  if (check) meta.push(<span key="check" className="font-mono">{check}</span>);

  const sev = severity ? severityStyle(severity) : null;

  return (
    <div className="rounded-md border p-3 hover:bg-muted/30 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {id && <span className="font-mono text-xs font-medium truncate">{id}</span>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {domain && (
            <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {domain}
            </span>
          )}
          {sev && (
            <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium', sev.className)}>
              {sev.label}
            </span>
          )}
        </div>
      </div>
      {message && (
        <p className="mt-1.5 text-sm leading-normal break-words">{message}</p>
      )}
      {meta.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {meta.map((node, index) => (
            <React.Fragment key={index}>
              {index > 0 && <span aria-hidden>·</span>}
              {node}
            </React.Fragment>
          ))}
        </div>
      )}
      {otherEntries.length > 0 && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {otherEntries.map(([subKey, subValue]) => (
            <div key={subKey}>
              <dt className="text-muted-foreground font-medium mb-0.5">{formatKey(subKey)}</dt>
              <dd className="break-words">
                <MetadataValue value={subValue} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function ObjectCard({ item }: { item: Record<string, unknown> }) {
  const entries = Object.entries(item);
  // Use a 2-col grid when every value is short; otherwise fall back to single column.
  const allShort = entries.every(([, v]) => {
    if (v === null || v === undefined) return true;
    if (typeof v === 'string') return v.length <= SHORT_STRING_CHAR_THRESHOLD && !v.includes('\n');
    if (typeof v === 'number' || typeof v === 'boolean') return true;
    return false;
  });

  return (
    <div className="rounded-md border bg-muted/30 p-2">
      <dl
        className={cn(
          'gap-y-1 text-xs',
          allShort ? 'grid grid-cols-2 gap-x-3' : 'grid grid-cols-1',
        )}
      >
        {entries.map(([subKey, subValue]) => (
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

function MarkdownBlock({ entryKey, value }: { entryKey: string; value: string }) {
  return (
    <Collapsible.Root defaultOpen>
      <dt className="mb-1">
        <Collapsible.Trigger className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors">
          <ChevronDown className="h-3 w-3 transition-transform data-[state=closed]:-rotate-90" />
          {formatKey(entryKey)}
        </Collapsible.Trigger>
      </dt>
      <dd className="text-sm">
        <Collapsible.Content>
          <div className="prose prose-sm dark:prose-invert max-w-none overflow-auto max-h-[400px] rounded-md border bg-muted/20 p-3">
            <MarkdownContent content={value} />
          </div>
        </Collapsible.Content>
      </dd>
    </Collapsible.Root>
  );
}

/** Strict-pre code block for YAML/JSON-shaped strings — preserves structure exactly. */
function CodeBlock({ entryKey, value }: { entryKey: string; value: string }) {
  const lineCount = value.split('\n').length;
  const summary = `${lineCount} line${lineCount === 1 ? '' : 's'}`;

  return (
    <Collapsible.Root>
      <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
        {formatKey(entryKey)}
      </dt>
      <dd>
        <Collapsible.Trigger className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ChevronDown className="h-3 w-3 transition-transform data-[state=closed]:-rotate-90" />
          <span>{summary}</span>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <pre className="mt-2 rounded-md bg-muted p-3 text-xs leading-relaxed font-mono whitespace-pre overflow-x-auto max-h-[400px] overflow-y-auto">
            <code>{value}</code>
          </pre>
        </Collapsible.Content>
      </dd>
    </Collapsible.Root>
  );
}

function LongTextBlock({ entryKey, value }: { entryKey: string; value: string }) {
  const lineCount = value.split('\n').length;
  const preview = value.slice(0, 60).replace(/\s+/g, ' ').trim();
  const summary = lineCount > 1 ? `${lineCount} lines` : `${preview}${value.length > 60 ? '…' : ''}`;

  return (
    <Collapsible.Root>
      <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
        {formatKey(entryKey)}
      </dt>
      <dd>
        <Collapsible.Trigger className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ChevronDown className="h-3 w-3 transition-transform data-[state=closed]:-rotate-90" />
          <span>{summary}</span>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <pre className="mt-2 rounded-md bg-muted p-3 text-xs overflow-auto max-h-[400px] whitespace-pre-wrap break-words font-mono">
            {value}
          </pre>
        </Collapsible.Content>
      </dd>
    </Collapsible.Root>
  );
}

function MetadataValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground italic">-</span>;
  }

  if (typeof value === 'string') {
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
    if (/^https?:\/\//.test(trimmed)) {
      return (
        <a
          href={trimmed}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline break-all"
        >
          {trimmed}
        </a>
      );
    }
    return <span className="whitespace-pre-wrap break-words">{value}</span>;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span className="font-mono text-xs">{String(value)}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground italic">None</span>;

    // Simple string arrays render as comma-separated pills
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
      <div className="space-y-1.5">
        {value.map((item, index) => (
          <div key={index} className="rounded-md border bg-muted/30 p-2">
            {typeof item === 'object' && item !== null ? (
              <dl className="grid grid-cols-1 gap-y-1 text-xs">
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
      <div className="rounded-md border bg-muted/30 p-2">
        <dl className="grid grid-cols-1 gap-y-1 text-xs">
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
