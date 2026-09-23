import { z } from 'zod';

/**
 * One step of an Agent Trajectory (ADR-0023 D8): a tool call, a tool result,
 * a piece of assistant text, or the final result, as the agent CLI reported it.
 * Plugins map their CLI's stream into this shape; keys a CLI adds beyond the
 * named ones are kept when content is captured.
 */
export const AgentTrajectoryEntrySchema = z.looseObject({
  ts: z.string(),
  type: z.string(),
  subtype: z.string().optional(),
  tool: z.string().optional(),
  tool_name: z.string().optional(),
  tool_use_id: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  text: z.string().optional(),
  content: z.unknown().optional(),
  /** Set when content capture was off (ADR-0007 D5): only the shape was kept. */
  redacted: z.literal(true).optional(),
});

export const StoredAgentTrajectoryEntrySchema = AgentTrajectoryEntrySchema.extend({
  /** Position within the Agent Run, from 0, across retries of the same run. */
  seq: z.number().int().nonnegative(),
});

export const AgentTrajectorySchema = z.object({
  agentRunId: z.string(),
  entries: z.array(StoredAgentTrajectoryEntrySchema),
});

export type AgentTrajectoryEntry = z.infer<typeof AgentTrajectoryEntrySchema>;
export type StoredAgentTrajectoryEntry = z.infer<typeof StoredAgentTrajectoryEntrySchema>;
export type AgentTrajectory = z.infer<typeof AgentTrajectorySchema>;

function redactedSize(value: unknown): string {
  const size = typeof value === 'string' ? value.length : (JSON.stringify(value) ?? '').length;
  return `[redacted: ${size} chars]`;
}

/**
 * The shape of an entry with its content removed, for when content capture is
 * off: tool names and argument keys survive, every argument value, text and
 * tool result becomes its size. Keys outside the named ones are dropped, since
 * a CLI's extra fields can carry content too.
 */
export function redactTrajectoryEntry(entry: AgentTrajectoryEntry): AgentTrajectoryEntry {
  return {
    ts: entry.ts,
    type: entry.type,
    ...(entry.subtype !== undefined ? { subtype: entry.subtype } : {}),
    ...(entry.tool !== undefined ? { tool: entry.tool } : {}),
    ...(entry.tool_name !== undefined ? { tool_name: entry.tool_name } : {}),
    ...(entry.tool_use_id !== undefined ? { tool_use_id: entry.tool_use_id } : {}),
    ...(entry.input !== undefined
      ? { input: Object.fromEntries(Object.entries(entry.input).map(([key, value]) => [key, redactedSize(value)])) }
      : {}),
    ...(entry.text !== undefined ? { text: redactedSize(entry.text) } : {}),
    ...(entry.content !== undefined ? { content: redactedSize(entry.content) } : {}),
    redacted: true,
  };
}
