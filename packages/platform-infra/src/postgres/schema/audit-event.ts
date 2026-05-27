import { pgTable, text, uuid, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
// `process_instance_id` is `text` not `uuid` because process_instances
// keeps Firestore-shaped string ids during the dual-code window. Post-
// cutover, ids stay text (no need to convert).
import { workspaces } from './workspace.js';

/**
 * Append-only audit log (PLAN-0001 §1.2 audit_events).
 *
 * Hybrid storage: hot query fields are extracted as columns; the legible
 * payload (description, basis, snapshots) lives in `payload` jsonb. The
 * `workspace` column is derived at insert time from the parent
 * ProcessInstance — AuditEvent itself carries no namespace field.
 *
 * Append-only: no `updated_at`, no `set_updated_at` trigger. `timestamp`
 * comes from the caller (ISO string); `server_timestamp` defaults to
 * `now()` so the DB always records when the row landed.
 *
 * `process_instance_id` is `uuid` with no FK constraint right now — the
 * `process_instances` table arrives in a later PR2 migration. FK to
 * `process_instances.id` added in #9 migration.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspace: text('workspace')
      .notNull()
      .references(() => workspaces.handle, { onDelete: 'cascade' }),

    // Attributable
    actorId: text('actor_id').notNull(),
    actorType: text('actor_type').notNull(),
    actorRole: text('actor_role').notNull(),

    // Legible / Accurate
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),

    // Context — FK to process_instances.id added in #9 migration.
    processInstanceId: text('process_instance_id'),
    stepId: text('step_id'),
    processDefinitionVersion: text('process_definition_version'),
    executorType: text('executor_type'),
    reviewerType: text('reviewer_type'),

    // Contemporaneous
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    serverTimestamp: timestamp('server_timestamp', { withTimezone: true })
      .notNull()
      .defaultNow(),

    // Original snapshots + legible description + basis
    payload: jsonb('payload').notNull().$type<{
      description: string;
      basis: string;
      inputSnapshot: Record<string, unknown>;
      outputSnapshot: Record<string, unknown>;
    }>(),
  },
  (table) => ({
    entityIdx: index('audit_events_entity_idx').on(
      table.workspace,
      table.entityType,
      table.entityId,
      table.timestamp.desc(),
    ),
    processIdx: index('audit_events_process_idx').on(
      table.workspace,
      table.processInstanceId,
      table.timestamp.asc(),
    ),
  }),
);
