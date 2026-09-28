/**
 * The log formatters have to be reachable by name, not by closure: the queued
 * spawn path sends the job through Redis, where a function cannot travel, and
 * the worker is the only process that sees a line while the container is still
 * running. Formatting by name is what lets the worker write the same entries
 * the local path writes live, instead of the orchestrator rebuilding them all
 * after exit.
 */
import { describe, it, expect } from 'vitest';
import { formatAgentLogLine, stageLogEntry, AgentLogFormatSchema } from '../agent-log-format';

describe('formatAgentLogLine', () => {
  it('formats a claude stream-json assistant tool call', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] },
    });

    const entries = formatAgentLogLine('claude-stream-json', line).map((e) => JSON.parse(e));

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: 'assistant', subtype: 'tool_call', tool: 'Bash' });
  });

  it('formats an opencode text event', () => {
    const line = JSON.stringify({ type: 'text', part: { text: 'hello' } });

    const entries = formatAgentLogLine('opencode-jsonl', line).map((e) => JSON.parse(e));

    expect(entries).toEqual([
      expect.objectContaining({ type: 'assistant', subtype: 'text', text: 'hello' }),
    ]);
  });

  it('emits nothing for a format that carries no structured output', () => {
    expect(formatAgentLogLine('none', '{"type":"text"}')).toEqual([]);
  });

  it('passes a script line through verbatim under the raw format', () => {
    expect(formatAgentLogLine('raw', '  installing packages  ')).toEqual(['installing packages']);
    expect(formatAgentLogLine('raw', '   ')).toEqual([]);
  });

  it('swallows unparseable lines rather than throwing into the stream reader', () => {
    expect(formatAgentLogLine('claude-stream-json', 'not json')).toEqual([]);
    expect(formatAgentLogLine('opencode-jsonl', 'not json')).toEqual([]);
  });

  it('accepts every format the schema names', () => {
    for (const format of AgentLogFormatSchema.options) {
      expect(() => formatAgentLogLine(format, '{}')).not.toThrow();
    }
  });
});

describe('stage entries', () => {
  it('classifies as its own type, so setup work is never mistaken for a result', () => {
    const entry = JSON.parse(stageLogEntry('Preparing container image acme:1'));
    expect(entry).toMatchObject({ type: 'stage', text: 'Preparing container image acme:1' });
    expect(entry.ts).toEqual(expect.any(String));
  });
});
