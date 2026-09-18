/**
 * Agent stdout → activity-log entries, selected by name rather than by closure:
 * on the queued path the worker does the formatting, on the far side of Redis,
 * where a function cannot travel.
 */
import { z } from 'zod';

export const AgentLogFormatSchema = z.enum(['claude-stream-json', 'opencode-jsonl', 'raw', 'none']);
export type AgentLogFormat = z.infer<typeof AgentLogFormatSchema>;

interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  message?: {
    role?: string;
    content?: Array<{ type: string; name?: string; input?: unknown; text?: string }>;
    usage?: Record<string, number | undefined>;
  };
  result?: string;
  tool_name?: string;
  tool_input?: unknown;
  [key: string]: unknown;
}

interface LogEntry {
  ts: string;
  type: string;
  subtype?: string;
  tool?: string;
  input?: Record<string, unknown>;
  text?: string;
  [key: string]: unknown;
}

function formatClaudeEvent(event: ClaudeStreamEvent): string[] {
  const ts = new Date().toISOString();
  const entries: LogEntry[] = [];

  if (event.type === 'assistant' && event.message?.content) {
    for (const block of event.message.content) {
      if (block.type === 'tool_use' && block.name) {
        entries.push({
          ts,
          type: 'assistant',
          subtype: 'tool_call',
          tool: block.name,
          input: block.input as Record<string, unknown> | undefined,
        });
      }
      if (block.type === 'text' && block.text) {
        entries.push({ ts, type: 'assistant', subtype: 'text', text: block.text });
      }
    }
    return entries.map((entry) => JSON.stringify(entry));
  }

  if (event.type === 'tool_result') {
    entries.push({
      ts,
      type: 'tool_result',
      tool_name: event.tool_name as string | undefined,
      subtype: event.subtype,
      content: event.content,
    });
    return entries.map((entry) => JSON.stringify(entry));
  }

  // CLI stream-json sends tool results as `user` messages with tool_result content blocks
  if (event.type === 'user' && event.message?.content) {
    for (const block of event.message.content) {
      if (block.type === 'tool_result') {
        const resultContent = (block as Record<string, unknown>).content;
        const preview = typeof resultContent === 'string'
          ? resultContent.slice(0, 500)
          : JSON.stringify(resultContent ?? '').slice(0, 500);
        entries.push({
          ts,
          type: 'user',
          subtype: 'tool_result',
          tool_use_id: (block as Record<string, unknown>).tool_use_id as string | undefined,
          content: preview,
        });
      }
    }
    if (entries.length > 0) {
      return entries.map((entry) => JSON.stringify(entry));
    }
  }

  if (event.type === 'result') {
    entries.push({
      ts,
      type: 'result',
      subtype: event.subtype,
      text: typeof event.result === 'string' ? event.result.slice(0, 500) : undefined,
    });
    return entries.map((entry) => JSON.stringify(entry));
  }

  // Generic fallback: capture any event type we don't explicitly handle
  const { type, subtype, ...rest } = event;
  entries.push({ ts, type, subtype, ...rest });
  return entries.map((entry) => JSON.stringify(entry));
}

interface OpenCodeEvent {
  type?: string;
  timestamp?: number;
  part?: {
    type?: string;
    text?: string;
    tool?: string;
    callID?: string;
    state?: {
      status?: string;
      input?: Record<string, unknown>;
      output?: string;
      error?: string;
    };
    cost?: number;
    tokens?: Record<string, unknown>;
    reason?: string;
  };
}

function formatOpenCodeEvent(event: OpenCodeEvent): string[] {
  const ts = event.timestamp
    ? new Date(event.timestamp).toISOString()
    : new Date().toISOString();

  if (event.type === 'text' && event.part?.text) {
    return [JSON.stringify({ ts, type: 'assistant', subtype: 'text', text: event.part.text })];
  }

  if (event.type === 'tool_use' && event.part?.tool) {
    const entries: string[] = [];
    const toolName = event.part.tool;
    const state = event.part.state;

    entries.push(JSON.stringify({
      ts,
      type: 'assistant',
      subtype: 'tool_call',
      tool: toolName,
      input: state?.input,
    }));

    if (state?.output || state?.error) {
      entries.push(JSON.stringify({
        ts,
        type: 'tool_result',
        tool_name: toolName,
        content: state.error
          ? `[error] ${state.error}`
          : (state.output ?? '').slice(0, 500),
      }));
    }

    return entries;
  }

  if (event.type === 'step_finish' && event.part) {
    return [JSON.stringify({
      ts,
      type: 'result',
      subtype: event.part.reason ?? 'completed',
      cost: event.part.cost,
      tokens: event.part.tokens,
    })];
  }

  // step_start and the rest carry nothing a reader of the activity log wants.
  return [];
}

/**
 * JSONL entries for one raw stdout line, or `[]` when the line carries nothing
 * loggable. Never throws: it runs inside a stream reader, where an exception
 * would tear down the container's output handling mid-run.
 */
export function formatAgentLogLine(format: AgentLogFormat, line: string): string[] {
  if (format === 'none') return [];

  const trimmed = line.trim();

  // A script's stdout is plain text with no event structure. It goes to the log
  // verbatim, which is what the viewer's raw fallback renders.
  if (format === 'raw') return trimmed.length > 0 ? [trimmed] : [];

  if (trimmed.startsWith('{') === false) return [];

  try {
    const event = JSON.parse(trimmed) as unknown;
    return format === 'claude-stream-json'
      ? formatClaudeEvent(event as ClaudeStreamEvent)
      : formatOpenCodeEvent(event as OpenCodeEvent);
  } catch {
    return [];
  }
}

/**
 * A JSONL entry for work that happens around the agent rather than inside it —
 * pulling or building the image, most of all. A cold build is minutes during
 * which the container does not exist yet and so emits nothing, which is most of
 * what "the step sat on running with an empty log" actually is.
 */
export function stageLogEntry(text: string): string {
  return JSON.stringify({ ts: new Date().toISOString(), type: 'stage', text });
}

/**
 * Append one stage entry, best-effort. Both the orchestrator and the worker
 * narrate the same setup work, and neither may fail a run over a log write.
 */
export async function appendStageEntry(logFile: string | null, text: string): Promise<void> {
  if (logFile === null) return;
  const { appendFile, mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  try {
    await mkdir(dirname(logFile), { recursive: true });
    await appendFile(logFile, stageLogEntry(text) + '\n');
  } catch {
    // The run matters more than its narration.
  }
}
