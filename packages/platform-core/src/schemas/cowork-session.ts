import { z } from 'zod';
import { McpServerConfigSchema } from './mcp-server-config.js';

// ---------------------------------------------------------------------------
// ConversationTurn — a single message in a cowork conversation
// ---------------------------------------------------------------------------

const BaseTurnFields = {
  id: z.string().min(1),
  content: z.string(),
  timestamp: z.string().datetime(),
  artifactDelta: z.record(z.string(), z.unknown()).nullable(),
} as const;

export const HumanTurnSchema = z.object({
  role: z.literal('human'),
  ...BaseTurnFields,
});

export const AgentTurnSchema = z.object({
  role: z.literal('agent'),
  ...BaseTurnFields,
});

export const ToolTurnSchema = z.object({
  role: z.literal('tool'),
  ...BaseTurnFields,
  /** Tool name (namespaced as serverName__toolName) */
  toolName: z.string(),
  /** Arguments passed to the tool */
  toolArgs: z.record(z.string(), z.unknown()),
  /** Tool execution result (stringified) — absent while status is 'running' */
  toolResult: z.string().optional(),
  /** Tool execution status */
  toolStatus: z.enum(['running', 'success', 'error']),
  /** MCP server name that owns this tool */
  serverName: z.string(),
});

export const ConversationTurnSchema = z.discriminatedUnion('role', [
  HumanTurnSchema,
  AgentTurnSchema,
  ToolTurnSchema,
]);

export type ConversationTurn = z.infer<typeof ConversationTurnSchema>;
export type HumanTurn = z.infer<typeof HumanTurnSchema>;
export type AgentTurn = z.infer<typeof AgentTurnSchema>;
export type ToolTurn = z.infer<typeof ToolTurnSchema>;

// ---------------------------------------------------------------------------
// CoworkSession — collaborative artifact construction between human and agent
// ---------------------------------------------------------------------------

export const CoworkSessionStatusSchema = z.enum([
  'active',       // conversation in progress
  'finalized',    // artifact accepted, workflow advanced
  'abandoned',    // session abandoned
]);

export const CoworkAgentSchema = z.enum(['chat', 'voice-realtime']);

export const CoworkVoiceConfigSchema = z.object({
  voice: z.string(),
  synthesisModel: z.string(),
  maxDurationSeconds: z.number(),
  idleTimeoutSeconds: z.number(),
});

export const CoworkSessionSchema = z.object({
  id: z.string().min(1),
  processInstanceId: z.string().min(1),
  stepId: z.string().min(1),
  assignedRole: z.string().min(1),
  assignedUserId: z.string().nullable(),
  status: CoworkSessionStatusSchema,
  agent: CoworkAgentSchema,
  model: z.string().nullable(),
  systemPrompt: z.string().nullable(),
  outputSchema: z.record(z.string(), z.unknown()).nullable(),
  voiceConfig: CoworkVoiceConfigSchema.nullable(),
  artifact: z.record(z.string(), z.unknown()).nullable(),
  /** MCP servers available during this cowork session */
  mcpServers: z.array(McpServerConfigSchema).nullable().default(null),
  turns: z.array(ConversationTurnSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  finalizedAt: z.string().datetime().nullable(),
});

export type CoworkSessionStatus = z.infer<typeof CoworkSessionStatusSchema>;
export type CoworkSession = z.infer<typeof CoworkSessionSchema>;
