'use client';

import * as React from 'react';
import { RefreshCw, FileText, Bot, CheckCircle2, Search, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LogEntry {
  ts: string;
  kind: 'tool_call' | 'assistant' | 'result';
  tool?: string;
  input?: Record<string, unknown>;
  text?: string;
  subtype?: string;
}

interface AgentLogViewerProps {
  logFile: string | null;
}

import type { LucideIcon } from 'lucide-react';

const TOOL_ICONS: Record<string, LucideIcon> = {
  Read: FileText,
  Glob: FolderOpen,
  Grep: Search,
};

/** Shorten temp paths to just the filename for readability. */
function cleanPath(value: string): string {
  // /var/folders/.../mediforce-agent-xxx/filename.pdf → filename.pdf
  return value.replace(/\/var\/folders\/[^/]+\/[^/]+\/T\/mediforce-agent-[^/]+\//g, '');
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

function ElapsedBadge({ prevTs, currentTs }: { prevTs: string | null; currentTs: string }) {
  if (!prevTs) return null;
  const elapsed = new Date(currentTs).getTime() - new Date(prevTs).getTime();
  if (elapsed < 500) return null;
  const seconds = (elapsed / 1000).toFixed(1);
  return (
    <span className="text-[10px] text-muted-foreground bg-muted rounded px-1 py-0.5 ml-2">
      +{seconds}s
    </span>
  );
}

function ToolCallEntry({ entry }: { entry: LogEntry }) {
  const IconComponent: LucideIcon = (entry.tool ? TOOL_ICONS[entry.tool] : undefined) ?? Bot;
  const inputStr = entry.input ? cleanPath(JSON.stringify(entry.input)) : '';

  // Extract the most useful info from common tool inputs
  let summary = '';
  if (entry.input) {
    if (entry.tool === 'Read' && typeof entry.input.file_path === 'string') {
      const filename = cleanPath(entry.input.file_path);
      const pages = entry.input.pages ? ` (p${entry.input.pages})` : '';
      summary = `${filename}${pages}`;
    } else if (entry.tool === 'Glob' && typeof entry.input.pattern === 'string') {
      summary = entry.input.pattern;
    } else if (entry.tool === 'Grep' && typeof entry.input.pattern === 'string') {
      summary = `/${entry.input.pattern}/`;
    } else if (entry.tool === 'Write' && typeof entry.input.file_path === 'string') {
      summary = cleanPath(entry.input.file_path);
    } else if (entry.tool === 'Bash' && typeof entry.input.command === 'string') {
      summary = (entry.input.command as string).slice(0, 80);
    } else {
      summary = inputStr.slice(0, 120);
    }
  }

  return (
    <div className="flex items-start gap-2 py-1">
      <div className="mt-0.5 shrink-0 w-5 h-5 rounded bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
        <IconComponent className="h-3 w-3 text-purple-600 dark:text-purple-400" />
      </div>
      <div className="min-w-0 flex-1">
        <span className="text-xs font-medium text-purple-700 dark:text-purple-300">{entry.tool}</span>
        {summary && (
          <span className="text-xs text-muted-foreground ml-1.5 font-mono">{summary}</span>
        )}
      </div>
    </div>
  );
}

function AssistantEntry({ entry }: { entry: LogEntry }) {
  const text = (entry.text ?? '').slice(0, 300).replace(/\n/g, ' ');
  return (
    <div className="flex items-start gap-2 py-1.5">
      <div className="mt-0.5 shrink-0 w-5 h-5 rounded bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
        <Bot className="h-3 w-3 text-blue-600 dark:text-blue-400" />
      </div>
      <p className="text-xs text-foreground/80 italic">{text}</p>
    </div>
  );
}

function ResultEntry({ entry }: { entry: LogEntry }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <div className="mt-0.5 shrink-0 w-5 h-5 rounded bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
        <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400" />
      </div>
      <span className="text-xs font-medium text-green-700 dark:text-green-300">
        Done ({entry.subtype ?? 'completed'})
      </span>
    </div>
  );
}

function parseLogEntries(content: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as LogEntry);
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

export function AgentLogViewer({ logFile }: AgentLogViewerProps) {
  const [entries, setEntries] = React.useState<LogEntry[]>([]);
  const [rawContent, setRawContent] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const fetchLog = React.useCallback(async () => {
    if (!logFile) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/agent-logs?file=${encodeURIComponent(logFile)}`);
      const data = await response.json() as { content: string; error?: string };
      if (data.error && !data.content) {
        setError(data.error);
      } else {
        setError(null);
        const parsed = parseLogEntries(data.content);
        if (parsed.length > 0) {
          setEntries(parsed);
          setRawContent(null);
        } else if (data.content.trim()) {
          // Fallback: plain-text log (old format)
          setEntries([]);
          setRawContent(data.content);
        } else {
          setEntries([]);
          setRawContent(null);
        }
      }
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to fetch log');
    } finally {
      setLoading(false);
    }
  }, [logFile]);

  React.useEffect(() => { fetchLog(); }, [fetchLog]);

  React.useEffect(() => {
    if (!autoRefresh || !logFile) return;
    const interval = setInterval(fetchLog, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh, logFile, fetchLog]);

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  if (!logFile) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        No agent log available for this run.
      </div>
    );
  }

  // Group consecutive tool_calls into parallel batches
  const groups: Array<{ kind: 'batch'; entries: LogEntry[]; ts: string } | { kind: 'single'; entry: LogEntry }> = [];
  let currentBatch: LogEntry[] = [];

  for (const entry of entries) {
    if (entry.kind === 'tool_call') {
      currentBatch.push(entry);
    } else {
      if (currentBatch.length > 0) {
        groups.push({ kind: 'batch', entries: currentBatch, ts: currentBatch[0].ts });
        currentBatch = [];
      }
      groups.push({ kind: 'single', entry });
    }
  }
  if (currentBatch.length > 0) {
    groups.push({ kind: 'batch', entries: currentBatch, ts: currentBatch[0].ts });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {entries.length > 0 && <span>{entries.length} events</span>}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
              className="rounded border-border"
            />
            Auto-refresh
          </label>
          <button
            onClick={fetchLog}
            disabled={loading}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-amber-600 dark:text-amber-400">{error}</div>
      )}

      <div
        ref={scrollRef}
        className="border rounded-md p-3 overflow-auto max-h-[500px] space-y-0.5"
      >
        {groups.length === 0 && !rawContent && (
          <p className="text-xs text-muted-foreground text-center py-4">
            {loading ? 'Loading...' : 'Waiting for agent activity...'}
          </p>
        )}
        {rawContent && (
          <pre className="text-xs font-mono whitespace-pre-wrap break-all">{rawContent}</pre>
        )}
        {groups.map((group, groupIndex) => {
          const prevTs = groupIndex > 0
            ? (groups[groupIndex - 1].kind === 'batch'
              ? (groups[groupIndex - 1] as { ts: string }).ts
              : (groups[groupIndex - 1] as { entry: LogEntry }).entry.ts)
            : null;
          const currentTs = group.kind === 'batch' ? group.ts : group.entry.ts;

          return (
            <div key={groupIndex}>
              {/* Time + elapsed badge */}
              <div className="flex items-center gap-1 mt-2 first:mt-0">
                <span className="text-[10px] text-muted-foreground font-mono">{formatTime(currentTs)}</span>
                <ElapsedBadge prevTs={prevTs} currentTs={currentTs} />
              </div>

              {group.kind === 'batch' ? (
                <div className={cn('ml-2', group.entries.length > 1 && 'border-l-2 border-purple-200 dark:border-purple-800 pl-2')}>
                  {group.entries.length > 1 && (
                    <span className="text-[10px] text-muted-foreground">{group.entries.length} parallel calls</span>
                  )}
                  {group.entries.map((entry, entryIndex) => (
                    <ToolCallEntry key={entryIndex} entry={entry} />
                  ))}
                </div>
              ) : group.entry.kind === 'assistant' ? (
                <AssistantEntry entry={group.entry} />
              ) : group.entry.kind === 'result' ? (
                <ResultEntry entry={group.entry} />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
