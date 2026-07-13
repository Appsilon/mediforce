import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  uuid,
  jsonb,
  timestamp,
  integer,
  numeric,
  index,
} from 'drizzle-orm/pg-core';
import { workspaces } from './workspace';
import { processInstances } from './process-instance';

/**
 * Per-step agent execution record (PLAN-0001 §1.2 agent_runs).
 *
 * Hybrid storage: query-worthy envelope fields (confidence, model,
 * duration_ms, token counts, cost) are extracted as columns; the rest of
 * the envelope (reasoning_summary, reasoning_chain, annotations,
 * gitMetadata, presentation, deliverableFile, result, confidence_rationale)
 * lives in `envelope_payload` jsonb. Lifting cost + model out enables the
 * `model + cost_usd` partial index for spend rollups.
 *
 * Append-only-ish: status changes are tracked via separate writes, no
 * `updated_at` / trigger. `started_at` + `completed_at` are sufficient.
 * `started_at` defaults to `now()` but writes pass it explicitly for
 * Firestore parity.
 *
 * The `workspace` column is derived at insert time from the parent
 * ProcessInstance — AgentRun itself carries no namespace field. Same
 * pattern as audit_events.
 *
 * `process_instance_id` is `text` with FK to `process_instances.id` added
 * in #10 migration (when `process_instances` lands). ON DELETE CASCADE
 * mirrors the Firestore subcollection lifetime.
 */
export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspace: text('workspace')
      .notNull()
      .references(() => workspaces.handle, { onDelete: 'cascade' }),

    // Context — FK to process_instances.id (added in #10 migration).
    // `text` not `uuid` — process_instances retains Firestore-style string
    // ids during dual-code; stays text post-cutover (no conversion needed).
    processInstanceId: text('process_instance_id')
      .notNull()
      .references(() => processInstances.id, { onDelete: 'cascade' }),
    stepId: text('step_id').notNull(),
    pluginId: text('plugin_id').notNull(),
    autonomyLevel: text('autonomy_level').notNull(),
    status: text('status').notNull(),
    fallbackReason: text('fallback_reason'),

    // Envelope: extracted query columns
    confidence: numeric('confidence'),
    model: text('model'),
    durationMs: integer('duration_ms'),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),

    // Envelope: everything else
    envelopePayload: jsonb('envelope_payload'),

    // For UI display
    executorType: text('executor_type'),
    reviewerType: text('reviewer_type'),

    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    instanceIdx: index('agent_runs_instance_idx').on(
      table.processInstanceId,
      table.stepId,
      table.startedAt.desc(),
    ),
    costIdx: index('agent_runs_cost_idx')
      .on(table.model, table.startedAt)
      .where(sql`${table.costUsd} is not null`),
  }),
);
