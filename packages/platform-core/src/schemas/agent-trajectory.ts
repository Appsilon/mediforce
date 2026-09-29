import { z } from 'zod';

/**
 * One step of an Agent Trajectory (ADR-0023 D8): a tool call, a tool result,
 * a piece of assistant text, or the final result, as the agent CLI reported it.
 * Plugins map their CLI's stream into this shape; keys a CLI adds beyond the
 * named ones are kept.
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
