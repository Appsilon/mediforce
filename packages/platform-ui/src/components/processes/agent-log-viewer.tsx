'use client';

import * as React from 'react';
import { FileText, Bot, CheckCircle2, Search, FolderOpen, Copy, Check, Circle, ListTodo, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LogEntry {
  ts: string;
  /** New format uses `type` + `subtype`, old format used `kind`. */
  type?: string;
  kind?: string;
  subtype?: string;
  tool?: string;
  tool_name?: string;
  input?: Record<string, unknown>;
  text?: string;
  content?: unknown;
  [key: string]: unknown;
}

interface AgentLogFile {
  stepId: string;
  file: string;
}

interface AgentLogViewerProps {
  logFiles: AgentLogFile[];
  initialStepId?: string | null;
}

interface AgentLogSection {
  stepId: string;
  entries: LogEntry[];
  rawContent: string | null;
  error: string | null;
}

import type { LucideIcon } from 'lucide-react';

/** Classify a log entry into a display category. Handles both old (kind) and new (type+subtype) formats. */
function classifyEntry(entry: LogEntry): 'tool_call' | 'tool_result' | 'assistant_text' | 'result' | 'skip' {
  // New format
  if (entry.type === 'assistant' && entry.subtype === 'tool_call') return 'tool_call';
  if (entry.type === 'assistant' && entry.subtype === 'text' && entry.text?.trim()) return 'assistant_text';
  if (entry.type === 'tool_result') return 'tool_result';
  if (entry.type === 'user' && entry.subtype === 'tool_result') return 'tool_result';
  if (entry.type === 'result') return 'result';
  // Old format
  if (entry.kind === 'tool_call') return 'tool_call';
  if (entry.kind === 'assistant' && entry.text?.trim()) return 'assistant_text';
  if (entry.kind === 'result') return 'result';
  return 'skip';
}

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

interface TodoItem {
  content: string;
  status: string;
  priority?: string;
}

function isTodoWriteEntry(entry: LogEntry): entry is LogEntry & { input: { todos: TodoItem[] } } {
  const toolName = (entry.tool ?? entry.tool_name ?? '').toLowerCase();
  if (toolName !== 'todowrite') return false;
  const todos = entry.input?.todos;
  return Array.isArray(todos) && todos.length > 0;
}

function TodoWriteEntry({ todos }: { todos: TodoItem[] }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <div className="mt-0.5 shrink-0 w-5 h-5 rounded bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
        <ListTodo className="h-3 w-3 text-amber-600 dark:text-amber-400" />
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Tasks</span>
        {todos.map((todo, index) => {
          const StatusIcon = todo.status === 'completed' ? CheckCircle2
            : todo.status === 'in_progress' ? Loader2
            : Circle;
          const statusColor = todo.status === 'completed' ? 'text-green-500'
            : todo.status === 'in_progress' ? 'text-blue-500'
            : 'text-muted-foreground';
          return (
            <div key={index} className="flex items-center gap-1.5">
              <StatusIcon className={cn('h-3 w-3 shrink-0', statusColor)} />
              <span className={cn(
                'text-xs',
                todo.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground/80',
              )}>
                {todo.content}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ToolCallEntry({ entry }: { entry: LogEntry }) {
  if (isTodoWriteEntry(entry)) {
    return <TodoWriteEntry todos={entry.input.todos} />;
  }

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

function ToolResultEntry({ entry }: { entry: LogEntry }) {
  const toolName = entry.tool_name ?? entry.tool ?? '';
  const content = entry.content;
  let summary = '';
  if (typeof content === 'string') {
    summary = content.slice(0, 300);
  } else if (content !== null && content !== undefined) {
    summary = JSON.stringify(content).slice(0, 300);
  }

  return (
    <div className="flex items-start gap-2 py-1">
      <div className="mt-0.5 shrink-0 w-5 h-5 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
        <CheckCircle2 className="h-3 w-3 text-gray-500 dark:text-gray-400" />
      </div>
      <div className="min-w-0 flex-1">
        {toolName && (
          <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{toolName} </span>
        )}
        {summary && (
          <p className="text-xs text-muted-foreground font-mono whitespace-pre-wrap line-clamp-3">{cleanPath(summary)}</p>
        )}
      </div>
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

type LogGroup = { kind: 'batch'; entries: LogEntry[]; ts: string } | { kind: 'single'; entry: LogEntry; category: string };

function buildGroups(entries: LogEntry[]): LogGroup[] {
  const groups: LogGroup[] = [];
  let currentBatch: LogEntry[] = [];

  for (const entry of entries) {
    const category = classifyEntry(entry);
    if (category === 'skip') continue;

    if (category === 'tool_call') {
      currentBatch.push(entry);
    } else {
      if (currentBatch.length > 0) {
        groups.push({ kind: 'batch', entries: currentBatch, ts: currentBatch[0].ts });
        currentBatch = [];
      }
      groups.push({ kind: 'single', entry, category });
    }
  }
  if (currentBatch.length > 0) {
    groups.push({ kind: 'batch', entries: currentBatch, ts: currentBatch[0].ts });
  }
  return groups;
}

function LogGroupList({ groups }: { groups: LogGroup[] }) {
  return (
    <>
      {groups.map((group, groupIndex) => {
        const prevTs = groupIndex > 0
          ? (groups[groupIndex - 1].kind === 'batch'
            ? (groups[groupIndex - 1] as { ts: string }).ts
            : (groups[groupIndex - 1] as { entry: LogEntry }).entry.ts)
          : null;
        const currentTs = group.kind === 'batch' ? group.ts : group.entry.ts;

        return (
          <div key={groupIndex}>
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
            ) : group.category === 'assistant_text' ? (
              <AssistantEntry entry={group.entry} />
            ) : group.category === 'tool_result' ? (
              <ToolResultEntry entry={group.entry} />
            ) : group.category === 'result' ? (
              <ResultEntry entry={group.entry} />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

async function fetchSingleLog(file: string): Promise<{ entries: LogEntry[]; rawContent: string | null; error: string | null }> {
  try {
    const response = await fetch(`/api/agent-logs?file=${encodeURIComponent(file)}`);
    const data = await response.json() as { content: string; error?: string };
    if (data.error && !data.content) {
      return { entries: [], rawContent: null, error: data.error };
    }
    const parsed = parseLogEntries(data.content);
    if (parsed.length > 0) {
      return { entries: parsed, rawContent: null, error: null };
    } else if (data.content.trim()) {
      return { entries: [], rawContent: data.content, error: null };
    }
    return { entries: [], rawContent: null, error: null };
  } catch (fetchError) {
    return { entries: [], rawContent: null, error: fetchError instanceof Error ? fetchError.message : 'Failed to fetch log' };
  }
}

/** Serialize a section's log entries into readable plain text for clipboard. */
function serializeSectionToText(section: AgentLogSection): string {
  const lines: string[] = [];
  lines.push(`Agent: ${section.stepId}`);
  lines.push(`Events: ${section.entries.length}`);
  lines.push('---');

  if (section.rawContent) {
    lines.push(section.rawContent);
    return lines.join('\n');
  }

  let prevTs: string | null = null;
  for (const entry of section.entries) {
    const category = classifyEntry(entry);
    if (category === 'skip') continue;

    const time = formatTime(entry.ts);
    if (prevTs) {
      const elapsed = new Date(entry.ts).getTime() - new Date(prevTs).getTime();
      if (elapsed >= 500) {
        lines.push(`  +${(elapsed / 1000).toFixed(1)}s`);
      }
    }

    if (category === 'tool_call') {
      const tool = entry.tool ?? 'Tool';
      let detail = '';
      if (entry.input) {
        if (entry.tool === 'Bash' && typeof entry.input.command === 'string') {
          detail = entry.input.command;
        } else if (typeof entry.input.file_path === 'string') {
          detail = cleanPath(entry.input.file_path);
        } else if (typeof entry.input.pattern === 'string') {
          detail = entry.input.pattern;
        }
      }
      lines.push(`[${time}] ${tool} ${detail}`);
    } else if (category === 'assistant_text') {
      lines.push(`[${time}] ${(entry.text ?? '').slice(0, 500)}`);
    } else if (category === 'tool_result') {
      const content = typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content ?? '');
      lines.push(`[${time}] Result: ${content.slice(0, 500)}`);
    } else if (category === 'result') {
      lines.push(`[${time}] Done (${entry.subtype ?? 'completed'})`);
    }

    prevTs = entry.ts;
  }

  return lines.join('\n');
}

function AgentTabContent({ section }: { section: AgentLogSection }) {
  const groups = buildGroups(section.entries);
  const isEmpty = groups.length === 0 && !section.rawContent;

  return (
    <>
      {section.error && (
        <div className="text-xs text-amber-600 dark:text-amber-400 py-1">{section.error}</div>
      )}

      {isEmpty && !section.error && (
        <p className="text-xs text-muted-foreground py-2">
          Waiting for agent activity...
        </p>
      )}

      {section.rawContent && (
        <pre className="text-xs font-mono whitespace-pre-wrap break-all">{section.rawContent}</pre>
      )}

      <LogGroupList groups={groups} />
    </>
  );
}

function allSectionsFinished(sections: AgentLogSection[]): boolean {
  if (sections.length === 0) return false;
  return sections.every((s) => s.entries.some((e) => classifyEntry(e) === 'result'));
}

export function AgentLogViewer({ logFiles, initialStepId }: AgentLogViewerProps) {
  const [sections, setSections] = React.useState<AgentLogSection[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [pollingActive, setPollingActive] = React.useState(logFiles.length > 0);
  const [activeTab, setActiveTab] = React.useState(0);
  const [copied, setCopied] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // When initialStepId changes, select the matching tab
  React.useEffect(() => {
    if (!initialStepId || sections.length === 0) return;
    const index = sections.findIndex((s) => s.stepId === initialStepId);
    if (index >= 0) {
      setActiveTab(index);
    }
  }, [initialStepId, sections]);

  const fetchLogs = React.useCallback(async () => {
    if (logFiles.length === 0) return;
    setLoading(true);
    try {
      const results = await Promise.all(
        logFiles.map(async (logFile) => {
          const result = await fetchSingleLog(logFile.file);
          return { stepId: logFile.stepId, ...result };
        }),
      );
      setSections(results);
      if (allSectionsFinished(results)) {
        setPollingActive(false);
      }
    } finally {
      setLoading(false);
    }
  }, [logFiles]);

  React.useEffect(() => {
    if (logFiles.length > 0) setPollingActive(true);
    fetchLogs();
  }, [fetchLogs, logFiles.length]);

  React.useEffect(() => {
    if (!pollingActive || logFiles.length === 0) return;
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, [pollingActive, logFiles, fetchLogs]);

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [sections]);

  // Clamp active tab if sections change
  React.useEffect(() => {
    if (sections.length > 0 && activeTab >= sections.length) {
      setActiveTab(0);
    }
  }, [sections, activeTab]);

  if (logFiles.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        No agent log available for this run.
      </div>
    );
  }

  const totalEvents = sections.reduce((sum, section) => sum + section.entries.length, 0);
  const hasTabs = sections.length > 1;
  const activeSection = sections[activeTab] ?? null;

  const handleCopy = React.useCallback(async () => {
    if (!activeSection) return;
    const text = serializeSectionToText(activeSection);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [activeSection]);

  return (
    <div className="space-y-0">
      {/* Controls bar */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-muted-foreground">
          {totalEvents > 0 && <span>{totalEvents} events across {sections.length} agent{sections.length > 1 ? 's' : ''}</span>}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={handleCopy}
            disabled={sections.length === 0}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Terminal-style container */}
      <div className="border rounded-md overflow-hidden bg-background">
        {/* Tab bar — only shown when multiple agents */}
        {hasTabs && (
          <div className="flex items-stretch bg-muted/60 border-b overflow-x-auto">
            {sections.map((section, index) => {
              const isActive = index === activeTab;
              return (
                <button
                  key={index}
                  onClick={() => setActiveTab(index)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors border-r border-border/50 last:border-r-0',
                    isActive
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                  )}
                >
                  <Bot className={cn('h-3 w-3', isActive ? 'text-blue-500' : 'text-muted-foreground/60')} />
                  {section.stepId}
                  {section.entries.length > 0 && (
                    <span className={cn(
                      'text-[10px] rounded-full px-1.5 py-0.5 tabular-nums',
                      isActive
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                        : 'bg-muted text-muted-foreground',
                    )}>
                      {section.entries.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Log content area */}
        <div
          ref={scrollRef}
          className="p-3 overflow-auto max-h-[500px] space-y-0.5"
        >
          {sections.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              {loading ? 'Loading...' : 'Waiting for agent activity...'}
            </p>
          )}

          {/* Single agent — show directly */}
          {sections.length === 1 && activeSection && (
            <AgentTabContent section={activeSection} />
          )}

          {/* Multiple agents — show active tab */}
          {hasTabs && activeSection && (
            <AgentTabContent section={activeSection} />
          )}
        </div>
      </div>
    </div>
  );
}
