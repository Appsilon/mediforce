import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { workspaces } from './workspace';
import { processInstances } from './process-instance';

/**
 * Cowork session — collaborative artifact construction between human and
 * agent (PLAN-0001 §1.2 cowork_sessions + cowork_turns).
 *
 * Soft-mutable: status transitions active → finalized | abandoned, plus
 * in-place updates to `artifact` while running. Carries `updated_at` + a
 * `set_updated_at` trigger mirroring the Firestore impl which writes
 * `updatedAt` on every mutation.
 *
 * `id` is `text` not `uuid` so cutover preserves Firestore document ids
 * verbatim (Firestore-generated ids aren't UUID-shaped). Stays text
 * post-cutover — no later conversion needed.
 *
 * The `workspace` column is derived at insert time from the parent
 * ProcessInstance — CoworkSession itself carries no namespace field. Same
 * pattern as audit_events, agent_runs, human_tasks and handoff_entities.
 *
 * `process_instance_id` is `text` not `uuid` — process_instances retains
 * Firestore-style string ids during dual-code (see commit e354e1ce). FK
 * to `process_instances.id` added in #9 migration.
 */
export const coworkSessions = pgTable(
  'cowork_sessions',
  {
    id: text('id').primaryKey(),
    workspace: text('workspace')
      .notNull()
      .references(() => workspaces.handle, { onDelete: 'cascade' }),

    // Context — FK to process_instances.id added in #10 migration.
    processInstanceId: text('process_instance_id')
      .notNull()
      .references(() => processInstances.id, { onDelete: 'cascade' }),
    stepId: text('step_id').notNull(),

    // Assignment
    assignedRole: text('assigned_role').notNull(),
    assignedUserId: text('assigned_user_id'),

    // Lifecycle
    status: text('status').notNull(), // active | finalized | abandoned

    // Agent configuration captured at create time
    agent: text('agent').notNull(), // chat | voice-realtime
    model: text('model'),
    systemPrompt: text('system_prompt'),
    outputSchema: jsonb('output_schema'),
    voiceConfig: jsonb('voice_config'),
    mcpServers: jsonb('mcp_servers'),

    // Working artifact (mutates as the conversation progresses)
    artifact: jsonb('artifact'),
    // Live validation result from last update_artifact call
    validationResult: jsonb('validation_result'),
    // HTML presentation produced via update_presentation tool
    presentation: text('presentation'),

    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Workspace-scoped feed: most reads start here.
    workspaceStatusIdx: index('cowork_sessions_workspace_status_idx').on(
      table.workspace,
      table.status,
      table.createdAt,
    ),
    // Role queue (system actor reads).
    roleStatusIdx: index('cowork_sessions_role_status_idx').on(
      table.assignedRole,
      table.status,
      table.createdAt,
    ),
    // Per-instance lookup: `findMostRecentActive` and per-instance feeds.
    instanceStepIdx: index('cowork_sessions_instance_step_idx').on(
      table.processInstanceId,
      table.stepId,
    ),
  }),
);

/**
 * Cowork turn — a single message in a cowork conversation.
 *
 * Turns are append-only conceptually, but tool turns mutate in place when
 * a 'running' tool call transitions to 'success' / 'error'. The repo
 * exposes `addTurn` (append) and `updateTurn` (patch by id) accordingly.
 *
 * `id` is `text` so caller-provided ids are preserved verbatim. The
 * ConversationTurn Zod schema requires `id: string.min(1)` and chat
 * handlers mint `crypto.randomUUID()` strings — both fit fine into text.
 *
 * `(session_id, idx)` is unique: `idx` is the ordinal within the session,
 * computed inside `addTurn` as MAX(idx)+1. The unique constraint catches
 * accidental concurrent inserts at the same idx instead of silently
 * letting two turns share a slot.
 *
 * No `updated_at` / `set_updated_at` trigger — turns are mutated via
 * `updateTurn` which performs targeted UPDATEs; the parent session's
 * `updated_at` already records the "last activity" timestamp.
 */
export const coworkTurns = pgTable(
  'cowork_turns',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => coworkSessions.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),

    role: text('role').notNull(), // human | agent | tool
    content: text('content').notNull(),
    artifactDelta: jsonb('artifact_delta'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),

    // Tool-turn-only fields (NULL for human / agent turns).
    toolName: text('tool_name'),
    toolArgs: jsonb('tool_args'),
    toolResult: text('tool_result'),
    toolStatus: text('tool_status'), // running | success | error
    serverName: text('server_name'),
  },
  (table) => ({
    sessionIdxUnique: uniqueIndex('cowork_turns_session_idx_unique').on(
      table.sessionId,
      table.idx,
    ),
  }),
);
