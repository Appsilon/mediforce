import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  uuid,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { workspaces } from './workspace.js';
import { processInstances } from './process-instance.js';

/**
 * Human review / approval task (PLAN-0001 §1.2 human_tasks).
 *
 * Soft-mutable: status transitions pending → claimed → completed | cancelled.
 * Carries `updated_at` + a `set_updated_at` trigger mirroring the
 * Firestore impl which writes `updatedAt` on every mutation.
 *
 * Soft-delete via `deleted_at`: tombstones stay visible to admin queries
 * but are excluded from the role-queue partial index (and the in-app reads
 * that go through it). The Firestore schema uses a boolean `deleted` field
 * — this column models the same intent (NULL = active, non-NULL = soft
 * deleted) while making the partial index trivial.
 *
 * The `workspace` column is derived at insert time from the parent
 * ProcessInstance — HumanTask itself carries no namespace field. Same
 * pattern as audit_events and agent_runs.
 *
 * `process_instance_id` is `text` with FK to `process_instances.id` added
 * in #10 migration (when `process_instances` lands). ON DELETE CASCADE
 * mirrors the Firestore subcollection lifetime.
 */
export const humanTasks = pgTable(
  'human_tasks',
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

    // Assignment + lifecycle
    assignedRole: text('assigned_role').notNull(),
    assignedUserId: text('assigned_user_id'),  // soft claim (null until claimed)
    status: text('status').notNull(),          // pending | claimed | completed | cancelled
    deadline: timestamp('deadline', { withTimezone: true }),

    // Completion payload (structured response)
    completionData: jsonb('completion_data'),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    // Step-derived UI hints copied at create time so the form renders
    // without re-reading the WorkflowDefinition.
    ui: jsonb('ui'),
    params: jsonb('params'),
    selection: jsonb('selection'),
    options: jsonb('options'),
    verdicts: jsonb('verdicts'),

    creationReason: text('creation_reason').notNull(),  // human_executor | agent_review_l3

    // Soft-delete tombstone (NULL = active).
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Role queue: active tasks only, ordered by creation. Partial index
    // keeps tombstones out so the workflow inbox stays cheap.
    roleQueueIdx: index('human_tasks_role_queue_idx')
      .on(table.assignedRole, table.status, table.createdAt)
      .where(sql`${table.deletedAt} is null`),
    instanceIdx: index('human_tasks_instance_idx').on(
      table.processInstanceId,
      table.stepId,
    ),
  }),
);
