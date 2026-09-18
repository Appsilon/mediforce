'use client';

import * as React from 'react';
import { Bot, Terminal, CheckCircle2, ChevronRight, Copy, Check, ListTodo, Loader2, Clock } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { cn } from '@/lib/utils';
import { SearchField } from '@/components/ui/search-field';

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
  executor: string;
}

interface AgentLogViewerProps {
  logFiles: AgentLogFile[];
  initialStepId?: string | null;
  /** Omitted by callers that cannot know — the viewer then never concludes a
   *  run has stopped, and only the all-finished rule ends polling. */
  runningStepIds?: Set<string>;
  /** False once the run reaches a terminal status. Omitted when unknown. */
  runActive?: boolean;
}

export interface AgentLogSection {
  stepId: string;
  executor: string;
  entries: LogEntry[];
  rawContent: string | null;
  error: string | null;
}

/** Classify a log entry into a display category. Handles both old (kind) and new (type+subtype) formats. */
function classifyEntry(entry: LogEntry): 'tool_call' | 'tool_result' | 'assistant_text' | 'result' | 'stage' | 'skip' {
  // Setup around the agent (image build), not the agent's own output.
  if (entry.type === 'stage') return 'stage';
  if (entry.type === 'assistant' && entry.subtype === 'tool_call') return 'tool_call';
  if (entry.type === 'assistant' && entry.subtype === 'text' && entry.text?.trim()) return 'assistant_text';
  if (entry.type === 'tool_result') return 'tool_result';
  if (entry.type === 'user' && entry.subtype === 'tool_result') return 'tool_result';
  if (entry.type === 'result') return 'result';
  if (entry.kind === 'tool_call') return 'tool_call';
  if (entry.kind === 'assistant' && entry.text?.trim()) return 'assistant_text';
  if (entry.kind === 'result') return 'result';
  return 'skip';
}


/** Strip the macOS temp prefix: 60 characters of noise in front of the
 *  filename, which is the part that then gets truncated away. */
function cleanPath(value: string): string {
  return value.replace(
    /(?:\/private)?\/var\/folders\/[^/]+\/[^/]+\/T\/(?:mediforce-[a-z-]*[^/]*\/)?/g,
    '',
  );
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
  // Under two seconds is the agent working at its normal pace — worth no ink.
  if (elapsed < 2000) return null;
  const seconds = (elapsed / 1000).toFixed(1);
  return (
    <span className="block text-[10px] text-muted-foreground tabular-nums mb-1">
      +{seconds}s
    </span>
  );
}

interface TodoItem {
  content: string;
  status: string;
  priority?: string;
}

/** The task list as it stands, collapsed to the item in progress: the rest are
 *  a count until asked for. */
function TaskChecklist({ todos }: { todos: TodoItem[] }) {
  const done = todos.filter((todo) => todo.status === 'completed').length;
  const current = todos.find((todo) => todo.status === 'in_progress') ?? todos.find((todo) => todo.status !== 'completed');
  const rest = todos.filter((todo) => todo !== current);

  return (
    <details className="group mb-3 rounded-md border bg-card px-2.5 py-2">
      <summary className="flex items-center gap-2 cursor-pointer list-none text-[13px]">
        {current?.status === 'in_progress'
          ? <Loader2 className="h-3.5 w-3.5 shrink-0 text-primary animate-spin" />
          : <ListTodo className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground shrink-0">Plan</span>
        <span className="truncate min-w-0">{current?.content ?? 'All tasks done'}</span>
        <span className="ml-auto shrink-0 flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
          {done} of {todos.length}
          <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
        </span>
      </summary>
      <ul className="mt-2 pl-[22px] space-y-1.5">
        {rest.map((todo, index) => (
          <li key={index} className="flex items-start gap-2 text-[13px] text-muted-foreground">
            <span className={cn(
              'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
              todo.status === 'completed' ? 'bg-primary' : 'bg-border',
            )} />
            <span className={cn(todo.status === 'completed' && 'line-through decoration-border')}>{todo.content}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The argument worth showing. Both spellings of each key: Claude's tools send
 *  `file_path`, opencode's `filePath`, and a miss prints raw JSON. */
export function callSummary(entry: LogEntry): string {
  const input = entry.input;
  if (!input) return '';

  const path = input.file_path ?? input.filePath;
  if (typeof path === 'string') {
    const pages = input.pages ? ` (p${String(input.pages)})` : '';
    return `${cleanPath(path)}${pages}`;
  }
  if (typeof input.pattern === 'string') return cleanPath(input.pattern);
  if (typeof input.command === 'string') return cleanPath(input.command);
  if (typeof input.url === 'string') return input.url;
  return cleanPath(JSON.stringify(input));
}

/** What the call produced, so a closed row still answers "did it work". Line
 *  counts only — "11 chars" beside a `mkdir` says nothing. */
export function resultSummary(result: LogEntry | null): string {
  if (result === null) return '';
  const text = resultText(result).trim();
  if (text === '') return 'no output';
  const lines = text.split('\n').length;
  return lines > 1 ? `${lines.toLocaleString()} lines` : '';
}

function AssistantEntry({ entry }: { entry: LogEntry }) {
  const text = (entry.text ?? '').slice(0, 300).replace(/\n/g, ' ');
  return <p className="text-[13px] leading-relaxed max-w-[60ch] break-words">{text}</p>;
}

function resultText(entry: LogEntry): string {
  const content = entry.content;
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';
  return JSON.stringify(content, null, 2);
}

/** Searches both the shortened argument and the raw input: the row shows
 *  `ae.xpt` where the record holds the full path, and either alone would
 *  disagree with the screen. */
export function entryMatches(entry: LogEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return [
    entry.text ?? '',
    entry.tool ?? '',
    entry.tool_name ?? '',
    entry.subtype ?? '',
    callSummary(entry),
    entry.input === undefined ? '' : JSON.stringify(entry.input),
    resultText(entry),
  ].some((field) => field.toLowerCase().includes(needle));
}

/** A result with no call of its own to sit under. */
function ToolResultEntry({ entry }: { entry: LogEntry }) {
  const full = cleanPath(resultText(entry));
  if (full === '') return null;
  return <ResultBody text={full} />;
}

function ResultBody({ text }: { text: string }) {
  return (
    <pre className="mt-1.5 pl-3 border-l border-border font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-all max-h-64 overflow-y-auto overflow-x-hidden">
      {text}
    </pre>
  );
}

/** One row per call, output behind a click: a step makes dozens, and printing
 *  every result in full is what made the log a wall. */
function CallRow({ call, result }: { call: LogEntry; result: LogEntry | null }) {
  const summary = callSummary(call);
  const body = result === null ? '' : cleanPath(resultText(result));
  const outcome = resultSummary(result);

  const head = (
    <>
      <span className="font-mono text-[11px] font-semibold text-purple-700 dark:text-purple-300 shrink-0">
        {call.tool ?? call.tool_name}
      </span>
      {summary && (
        <span className="font-mono text-xs text-muted-foreground truncate min-w-0">{summary}</span>
      )}
    </>
  );

  if (body === '') {
    return <div className="flex items-baseline gap-2 py-0.5 min-w-0">{head}</div>;
  }

  return (
    <details className="group">
      <summary className="flex items-baseline gap-2 py-0.5 -mx-1 px-1 rounded-sm cursor-pointer list-none hover:bg-muted/60 min-w-0">
        {head}
        <span className="ml-auto shrink-0 flex items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums">
          {outcome}
          <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
        </span>
      </summary>
      <ResultBody text={body} />
    </details>
  );
}

function ResultEntry({ entry }: { entry: LogEntry }) {
  const failed = entry.subtype === 'error' || entry.subtype === 'error_max_turns';
  return (
    <div className="py-1.5 flex items-center gap-1.5">
      <CheckCircle2 className={cn('h-3 w-3 shrink-0', failed ? 'text-destructive' : 'text-green-600')} />
      <span className={cn(
        'text-xs font-medium',
        failed ? 'text-destructive' : 'text-green-700 dark:text-green-300',
      )}>
        {failed ? `Failed (${entry.subtype})` : 'Done'}
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
    }
  }
  return entries;
}

/** A tool call with the result it produced, once they have been paired back up. */
interface CallWithResult {
  call: LogEntry;
  result: LogEntry | null;
}

export type LogGroup =
  | { kind: 'calls'; ts: string; calls: CallWithResult[] }
  | { kind: 'single'; ts: string; entry: LogEntry; category: string };

const TASK_TOOL = 'todowrite';

function isTaskListCall(entry: LogEntry): boolean {
  return (entry.tool ?? entry.tool_name ?? '').toLowerCase() === TASK_TOOL;
}

/** `tool-calls` is the model pausing to use a tool, not the step finishing —
 *  it arrives several times per step. */
function isTurnBoundary(entry: LogEntry): boolean {
  return entry.type === 'result' && entry.subtype === 'tool-calls';
}

/** The agent resends the whole list each time it ticks an item, so the log
 *  holds many revisions of one piece of state. Latest wins. */
export function latestTodos(entries: LogEntry[]): TodoItem[] | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (classifyEntry(entry) !== 'tool_call' || !isTaskListCall(entry)) continue;
    const todos = entry.input?.todos;
    if (Array.isArray(todos) && todos.length > 0) return todos as TodoItem[];
  }
  return null;
}

/**
 * Timeline rows, pairing each call with its result. Pairing is positional —
 * the stream carries no id on the result side. Task-list writes are dropped;
 * {@link latestTodos} renders them, and their result echoes the call verbatim.
 */
export function buildGroups(entries: LogEntry[]): LogGroup[] {
  const groups: LogGroup[] = [];
  let pending: CallWithResult[] = [];

  const flush = (): void => {
    const shown = pending.filter((pair) => isTaskListCall(pair.call) === false);
    if (shown.length > 0) groups.push({ kind: 'calls', ts: shown[0].call.ts, calls: shown });
    pending = [];
  };

  for (const entry of entries) {
    const category = classifyEntry(entry);
    if (category === 'skip') continue;
    if (isTurnBoundary(entry)) continue;

    if (category === 'tool_call') {
      // A call after a result is the next turn, not a sibling of the last one.
      // Only calls issued together — no result between them — ran in parallel.
      if (pending.some((pair) => pair.result !== null)) flush();
      pending.push({ call: entry, result: null });
      continue;
    }

    if (category === 'tool_result') {
      const unmatched = pending.find((pair) => pair.result === null);
      if (unmatched) {
        unmatched.result = entry;
        continue;
      }
      flush();
      groups.push({ kind: 'single', ts: entry.ts, entry, category });
      continue;
    }

    flush();
    groups.push({ kind: 'single', ts: entry.ts, entry, category });
  }
  flush();
  return groups;
}

function LogGroupList({ groups }: { groups: LogGroup[] }) {
  return (
    <>
      {groups.map((group, groupIndex) => {
        const prevTs = groupIndex > 0 ? groups[groupIndex - 1].ts : null;
        const showTime = prevTs === null || formatTime(prevTs) !== formatTime(group.ts);

        return (
          // Time in the title rather than a gutter column of identical seconds.
          <div key={groupIndex} className="mt-2.5 first:mt-0" title={formatTime(group.ts)}>
            {showTime && <ElapsedBadge prevTs={prevTs} currentTs={group.ts} />}

            {group.kind === 'calls' ? (
              <div className={cn(group.calls.length > 1 && 'pl-2 border-l border-border')}>
                {group.calls.length > 1 && (
                  <span className="text-[10px] text-muted-foreground">{group.calls.length} parallel calls</span>
                )}
                {group.calls.map((pair, pairIndex) => (
                  <CallRow key={pairIndex} call={pair.call} result={pair.result} />
                ))}
              </div>
            ) : group.category === 'assistant_text' ? (
              <AssistantEntry entry={group.entry} />
            ) : group.category === 'tool_result' ? (
              <ToolResultEntry entry={group.entry} />
            ) : group.category === 'result' ? (
              <ResultEntry entry={group.entry} />
            ) : group.category === 'stage' ? (
              <div className="text-xs text-muted-foreground">{group.entry.text}</div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

async function fetchSingleLog(file: string): Promise<{ entries: LogEntry[]; rawContent: string | null; error: string | null }> {
  let response: Response;
  try {
    // `no-store`: the URL never changes while a step runs and the route sends
    // no cache headers, so the browser would serve the first response forever.
    response = await apiFetch(`/api/step-logs?file=${encodeURIComponent(file)}`, { cache: 'no-store' });
  } catch (fetchError) {
    const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
    return { entries: [], rawContent: null, error: `Network error (token/auth): ${msg}` };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let detail: string;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      detail = parsed.error ?? text;
    } catch {
      detail = text || response.statusText;
    }
    return { entries: [], rawContent: null, error: `HTTP ${response.status} ${response.statusText}: ${detail}` };
  }

  try {
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
  } catch (parseError) {
    return { entries: [], rawContent: null, error: `Failed to parse response: ${parseError instanceof Error ? parseError.message : String(parseError)}` };
  }
}

function AgentTabContent({ section, isRunning }: { section: AgentLogSection; isRunning: boolean }) {
  const groups = buildGroups(section.entries);
  const todos = latestTodos(section.entries);
  const isEmpty = groups.length === 0 && todos === null && !section.rawContent;

  return (
    <>
      {section.error && (
        <pre className="text-xs font-mono bg-destructive/8 text-destructive border border-destructive/20 rounded p-2 whitespace-pre-wrap break-all select-text my-1 leading-relaxed">
          {section.error}
        </pre>
      )}

      {isEmpty && !section.error && (
        <p className="text-[13px] text-muted-foreground py-2">
          {isRunning
            ? 'Starting up. The first lines appear as the agent works.'
            : 'This step wrote no log.'}
        </p>
      )}

      {section.rawContent && (
        <pre className="text-xs font-mono whitespace-pre-wrap break-all">{section.rawContent}</pre>
      )}

      {todos && <TaskChecklist todos={todos} />}

      <LogGroupList groups={groups} />
    </>
  );
}

/** Polls with nothing new to show before the viewer accepts that a finished run
 *  has nothing more to say. Three ticks is ~9s: long enough for the last lines
 *  of a step to land after the run flips terminal. */
const IDLE_POLLS_BEFORE_GIVING_UP = 3;

/**
 * Two rules, both on signals that always exist: every step reported a result,
 * or the run is over. A third keyed on step-execution rows froze the log
 * mid-step — a step between executions leaves that set empty.
 */
export function shouldStopPolling(input: {
  sections: AgentLogSection[];
  /** Absent when the caller cannot know, read as "still going": polling on
   *  costs a request, stopping early looks broken. */
  runActive?: boolean;
  idlePolls: number;
}): boolean {
  if (allSectionsFinished(input.sections)) return true;
  if (input.runActive !== false) return false;
  return input.idlePolls >= IDLE_POLLS_BEFORE_GIVING_UP;
}

/** Whether a step is still producing output, so a spinner under it is honest.
 *  One predicate for both views — they used to disagree, and the all-steps view
 *  would spin for a step with nothing to show. */
function isStillWorking(section: AgentLogSection, runningStepIds: Set<string> | undefined): boolean {
  if (runningStepIds?.has(section.stepId) !== true) return false;
  return section.entries.length > 0 && isSectionTerminal(section) === false;
}

/** The whole run, step by step, in definition order — the default view. Reading
 *  down it is reading what the run did. */
export function AgentLogSections({ sections, runningStepIds, openStepId }: {
  sections: AgentLogSection[];
  runningStepIds?: Set<string>;
  /** Opened on mount — the step the reader arrived from. */
  openStepId?: string | null;
}) {
  const single = sections.length === 1;
  // What the reader has opened or closed by hand. Without this, `open` would be
  // re-asserted on every 3s poll and a step you collapsed would spring back.
  const [overrides, setOverrides] = React.useState<Record<string, boolean>>({});

  return (
    <div className="space-y-1.5 min-w-0">
      {sections.map((section) => {
        const isRunning = runningStepIds?.has(section.stepId) === true;
        // A finished step is a heading until asked for; the one still working,
        // the one you came here for, and a lone step are open.
        const open = overrides[section.stepId]
          ?? (single || isRunning || section.stepId === openStepId);

        return (
          <details
            key={section.stepId}
            open={open}
            onToggle={(event) => {
              const next = (event.currentTarget as HTMLDetailsElement).open;
              setOverrides((prev) => (prev[section.stepId] === next ? prev : { ...prev, [section.stepId]: next }));
            }}
            className="group"
          >
            <summary className="flex items-center gap-2.5 rounded-md bg-muted/70 px-3 py-2.5 cursor-pointer list-none hover:bg-muted transition-colors">
              {section.executor === 'script'
                ? <Terminal className="h-4 w-4 shrink-0 text-muted-foreground" />
                : <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />}
              <span
                data-step-heading
                className="text-sm font-semibold truncate min-w-0"
                title={section.stepId}
              >
                {section.stepId}
              </span>
              {isRunning && <Loader2 className="h-3 w-3 shrink-0 text-primary animate-spin" />}
              <span className="ml-auto shrink-0 flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                {section.entries.length > 0 && section.entries.length}
                <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
              </span>
            </summary>
            {/* Everything the step did hangs off a rail under its own header,
                so depth is visible rather than inferred from type size. */}
            <div className="ml-[9px] border-l pl-4 pt-3 pb-2 min-w-0 overflow-hidden">
              <AgentTabContent section={section} isRunning={isRunning} />
              {isStillWorking(section, runningStepIds) && <ThinkingIndicator />}
            </div>
          </details>
        );
      })}
    </div>
  );
}

/** A real completion, not a `tool-calls` turn boundary — the model emits one of
 *  those every turn, the first within seconds of the step starting. */
function hasCompleted(section: AgentLogSection): boolean {
  return section.entries.some((entry) => classifyEntry(entry) === 'result' && isTurnBoundary(entry) === false);
}

function allSectionsFinished(sections: AgentLogSection[]): boolean {
  if (sections.length === 0) return false;
  return sections.every(hasCompleted);
}

/** True when no more output is expected from this section. */
function isSectionTerminal(section: AgentLogSection): boolean {
  return hasCompleted(section) || section.error !== null;
}

const THINKING_TEXT = 'Running...';

function ThinkingIndicator() {
  const [charCount, setCharCount] = React.useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setCharCount((prev) => (prev >= THINKING_TEXT.length ? 0 : prev + 1));
    }, 120);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-2 py-2 mt-1">
      <Clock className="h-3.5 w-3.5 text-blue-500 animate-spin shrink-0" />
      {/* Use visibility:hidden (not display:none) at char 0 so layout height stays constant — prevents scrollbar jump. */}
      <span
        className={cn('text-xs font-bold text-blue-500', charCount === 0 && 'invisible')}
        style={{ minWidth: '5.5rem' }}
      >
        {THINKING_TEXT.slice(0, Math.max(charCount, 1))}
      </span>
    </div>
  );
}

export function AgentLogViewer({ logFiles, initialStepId, runningStepIds, runActive }: AgentLogViewerProps) {
  const [sections, setSections] = React.useState<AgentLogSection[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [pollingActive, setPollingActive] = React.useState(logFiles.length > 0);
  const idlePollsRef = React.useRef(0);
  const prevEntryCountRef = React.useRef(0);
  const [copied, setCopied] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // The parent rebuilds these every 1.5s, so their identities cannot be effect
  // deps — `fetchLogs` would be reborn faster than its own 3s interval.
  const logFilesKey = logFiles.map((file) => `${file.stepId}:${file.file}`).join('|');
  const latest = React.useRef({ logFiles, runningStepIds, runActive });
  latest.current = { logFiles, runningStepIds, runActive };

  const fetchLogs = React.useCallback(async () => {
    if (logFiles.length === 0) return;
    setLoading(true);
    try {
      const results = await Promise.all(
        latest.current.logFiles.map(async (logFile) => {
          const result = await fetchSingleLog(logFile.file);
          return { stepId: logFile.stepId, executor: logFile.executor, ...result };
        }),
      );
      setSections(results);

      const entryCount = results.reduce((sum, section) => sum + section.entries.length, 0);
      idlePollsRef.current = entryCount > prevEntryCountRef.current ? 0 : idlePollsRef.current + 1;
      prevEntryCountRef.current = entryCount;

      if (shouldStopPolling({
        sections: results,
        ...(latest.current.runActive === undefined ? {} : { runActive: latest.current.runActive }),
        idlePolls: idlePollsRef.current,
      })) {
        setPollingActive(false);
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see logFilesKey
  }, [logFilesKey]);

  // A new set of files is a new run or a new step: start over, counters included.
  React.useEffect(() => {
    idlePollsRef.current = 0;
    prevEntryCountRef.current = 0;
    if (logFilesKey.length > 0) setPollingActive(true);
    fetchLogs();
  }, [fetchLogs, logFilesKey]);

  React.useEffect(() => {
    if (!pollingActive || logFilesKey.length === 0) return;
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, [pollingActive, logFilesKey, fetchLogs]);

  // Follow the tail only when already at it; `sections` is a new array every
  // poll. Measured before the paint, when the old position still counts.
  const wasAtBottomRef = React.useRef(true);
  React.useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    if (wasAtBottomRef.current) element.scrollTop = element.scrollHeight;
  }, [sections]);

  const handleScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    // A small tolerance: fractional scroll heights never land exactly.
    wasAtBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
  }, []);

  // Raw, not the rendered text: the view collapses and pairs things, which is
  // lossy for a bug report. This is the escape hatch.
  const handleCopyRaw = React.useCallback(async () => {
    const text = sections
      .map((section) => {
        const body = section.rawContent ?? section.entries.map((entry) => JSON.stringify(entry)).join('\n');
        return sections.length > 1 ? `# ${section.stepId}\n${body}` : body;
      })
      .join('\n\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [sections]);

  // Searching narrows the entries inside each step, and a step with nothing
  // left is dropped: a result page of empty headings answers nothing.
  const shown = React.useMemo(() => {
    if (query.trim() === '') return sections;
    return sections
      .map((section) => ({ ...section, entries: section.entries.filter((entry) => entryMatches(entry, query)) }))
      .filter((section) => section.entries.length > 0);
  }, [sections, query]);

  // Every hook is above this line: an early return between them changes the
  // hook count between renders, which React treats as a fatal error.
  if (logFiles.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        No agent log available for this run.
      </div>
    );
  }

  // The run's span, from the first entry to the last. Replaces the per-row
  // clock: one line at the foot answers "how long was this" without spending a
  // column on it.
  const allEntries = sections.flatMap((section) => section.entries);
  const span = allEntries.length > 1
    ? `${formatTime(allEntries[0].ts)} → ${formatTime(allEntries[allEntries.length - 1].ts)}`
    : null;
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-3 mb-2 shrink-0">
        <div className="text-xs text-muted-foreground tabular-nums">
          {span && <span>{span}</span>}
        </div>
        <button
          onClick={handleCopyRaw}
          disabled={sections.length === 0}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 shrink-0"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy raw'}
        </button>
      </div>

      <SearchField
        value={query}
        onChange={setQuery}
        placeholder="Search this run's log"
        className="mb-3 shrink-0"
      />

      {/* Every step, in order, each one collapsible. There is no "which step am
          I looking at" mode to be in: the running one is open, the finished
          ones are headings until you want them. */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        {shown.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            {query.trim() !== ''
              ? `Nothing in this log matches “${query.trim()}”.`
              : loading ? 'Loading…' : 'Waiting for the first step to write.'}
          </p>
        ) : (
          <AgentLogSections
            sections={shown}
            runningStepIds={runningStepIds}
            openStepId={initialStepId ?? null}
          />
        )}
      </div>
    </div>
  );
}
