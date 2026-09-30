import type { AgentTrajectoryEntry } from '../schemas/agent-trajectory';
import type { EvalRunMcpReport } from '../schemas/eval-run';
import { McpReplayMissSchema, type McpEvalServerPolicy, type McpReplayMiss, type McpTape, type McpTapeCall } from '../schemas/evaluation';

/** The Agent Trajectory entry a replayed call no recording answered becomes. */
export const MCP_REPLAY_MISS_ENTRY_TYPE = 'mcp_replay_miss';

/** `ts` is when the agent made the call. */
export function mcpReplayMissEntry(miss: McpReplayMiss, ts: string): AgentTrajectoryEntry {
  return { ts, type: MCP_REPLAY_MISS_ENTRY_TYPE, server: miss.server, tool: miss.tool, input: miss.arguments };
}

/** The replay misses an Agent Trajectory records. */
export function mcpReplayMissesOf(entries: readonly AgentTrajectoryEntry[]): McpReplayMiss[] {
  return entries.flatMap((entry) => {
    if (entry.type !== MCP_REPLAY_MISS_ENTRY_TYPE) return [];
    const miss = McpReplayMissSchema.safeParse({ server: entry.server, tool: entry.tool, arguments: entry.input ?? {} });
    return miss.success ? [miss.data] : [];
  });
}

/** JSON with every object's keys sorted, so equal arguments serialize equal. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** What a replay matches a call on: the tool and its arguments. */
export function mcpCallKey(call: Pick<McpTapeCall, 'tool' | 'arguments'>): string {
  return `${call.tool} ${canonicalJson(call.arguments)}`;
}

/** How many of a case's newest recordings a replay merges — enough to cover what varies between live trials, bounded as recordings accumulate. */
export const MCP_REPLAY_RECORDINGS = 20;

/**
 * Every recording of one MCP server for one Eval Case, oldest first, merged
 * into the tape a replay answers from (ADR-0023 D6): the newest tool list, and
 * for each distinct call — tool and arguments — the results the newest
 * recording that made it got, in its order.
 */
export function mergeMcpTapes(tapes: readonly McpTape[]): McpTape {
  let tools: McpTape['tools'] = [];
  const callsByKey = new Map<string, McpTapeCall[]>();
  for (const tape of tapes) {
    if (tape.tools.length > 0) tools = tape.tools;
    const recorded = new Map<string, McpTapeCall[]>();
    for (const call of tape.calls) {
      const key = mcpCallKey(call);
      recorded.set(key, [...(recorded.get(key) ?? []), call]);
    }
    for (const [key, calls] of recorded) callsByKey.set(key, calls);
  }
  return { tools, calls: [...callsByKey.values()].flat() };
}

/** The servers of a frozen MCP eval policy by the mode each ran in, each list sorted. */
export function mcpServersByMode(policy: Record<string, McpEvalServerPolicy>): Pick<EvalRunMcpReport, 'live' | 'replayed' | 'denied'> {
  const serversIn = (mode: McpEvalServerPolicy['mode']) =>
    Object.entries(policy).filter(([, server]) => server.mode === mode).map(([name]) => name).sort();
  return { live: serversIn('live'), replayed: serversIn('replay'), denied: serversIn('deny') };
}

/** The MCP eval policy an Eval Run froze — and a Step Qualification cites — in a sentence. */
export function describeMcpPolicy(policy: Record<string, McpEvalServerPolicy>): string {
  return describeMcpReport({ ...mcpServersByMode(policy), unrecordedCalls: [] });
}

/** How an Eval Run's trials reached MCP servers, in a sentence: every mode in use, and what replay could not answer. */
export function describeMcpReport(mcp: EvalRunMcpReport): string {
  const parts = [
    ...(mcp.live.length === 0 ? [] : [`${mcp.live.join(', ')} live`]),
    ...(mcp.replayed.length === 0 ? [] : [`${mcp.replayed.join(', ')} replayed`]),
    ...(mcp.denied.length === 0 ? [] : [`${mcp.denied.join(', ')} denied`]),
  ];
  if (parts.length === 0) return 'The step\'s agent has no MCP servers.';
  const sentences = [`MCP servers: ${parts.join('; ')}.`];
  if (mcp.live.length === 0) sentences.push('No trial made a live MCP call.');
  const unrecorded = mcp.unrecordedCalls.reduce((sum, call) => sum + call.count, 0);
  if (unrecorded > 0) {
    const calls = mcp.unrecordedCalls.map((call) => `${call.server}/${call.tool} ×${call.count}`).join(', ');
    sentences.push(`${unrecorded} replayed call${unrecorded === 1 ? '' : 's'} had no recording and got an error (${calls}).`);
  }
  return sentences.join(' ');
}
