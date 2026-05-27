import { pgTable, text, timestamp, primaryKey } from 'drizzle-orm/pg-core';

/**
 * Last-fire bookkeeping for cron triggers (PLAN-0001 §1.2).
 * Original Firestore path: cronTriggerState/{definitionName}:{triggerName}.
 *
 * No `workspace` column: the row is keyed by `(definitionName, triggerName)`
 * and the cron heartbeat reads across every workspace's definitions in a
 * single system-actor pass (see `packages/platform-api/src/handlers/cron/
 * heartbeat.ts`). The Firestore collection lived at the root for the same
 * reason — there is no workspace FK to declare.
 *
 * No `created_at` / `updated_at` columns: the repo interface exposes only
 * `get` / `set`, and `set` is an unconditional overwrite. The single
 * meaningful timestamp — `last_triggered_at` — comes from the caller and
 * is already on the row. Adding mirror columns would duplicate it.
 */
export const cronTriggerState = pgTable(
  'cron_trigger_state',
  {
    definitionName: text('definition_name').notNull(),
    triggerName: text('trigger_name').notNull(),
    lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.definitionName, table.triggerName] }),
  }),
);
