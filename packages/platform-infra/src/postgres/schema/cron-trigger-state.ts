import { pgTable, text, boolean, timestamp, primaryKey } from 'drizzle-orm/pg-core';

/**
 * Persisted **Cron Trigger** records (ADR-0010) — the live, mutable schedules
 * attached to workflows. Keyed by `(namespace, definitionName, triggerName)`.
 *
 * The physical table keeps its historical name `cron_trigger_state` (renaming it
 * would force a destructive drop/create under non-interactive drizzle-kit
 * generate); the domain concept is "Cron Trigger". The row now carries the live
 * operational config, not just a last-fire cache:
 *   - `enabled`            — start/stop; the heartbeat fires only enabled rows.
 *   - `schedule`           — live cadence (Definition schedule is a seed only).
 *   - `last_triggered_at`  — fire cursor; NULL until the first fire.
 */
export const cronTriggerState = pgTable(
  'cron_trigger_state',
  {
    namespace: text('namespace').notNull(),
    definitionName: text('definition_name').notNull(),
    triggerName: text('trigger_name').notNull(),
    schedule: text('schedule').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.namespace, table.definitionName, table.triggerName],
    }),
  }),
);
