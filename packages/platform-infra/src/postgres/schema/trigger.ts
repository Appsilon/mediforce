import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  boolean,
  jsonb,
  timestamp,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { workspaces } from './workspace';

/**
 * Unified `triggers` table (ADR-0011). One row per
 * `(namespace, workflow_name, trigger_name)`, discriminated by `type`; the
 * type payload lives in `config` jsonb. Generalises the cron-only
 * `cron_trigger_state` overlay to `manual` / `webhook` / `cron`.
 *
 * `last_triggered_at` is the cron fire cursor (nullable; always null for
 * `manual` / `webhook`). The partial unique index enforces one webhook per
 * `(namespace, workflow, path)`; the partial `type` index backs the
 * heartbeat's `listEnabledByType('cron')` sweep.
 */
export const triggers = pgTable(
  'triggers',
  {
    namespace: text('namespace')
      .notNull()
      .references(() => workspaces.handle, { onDelete: 'cascade' }),
    workflowName: text('workflow_name').notNull(),
    triggerName: text('trigger_name').notNull(),
    type: text('type').notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    config: jsonb('config').notNull(),
    lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.namespace, table.workflowName, table.triggerName] }),
    webhookPath: uniqueIndex('triggers_webhook_path_uq')
      .on(table.namespace, table.workflowName, sql`(${table.config}->>'path')`)
      .where(sql`${table.type} = 'webhook'`),
    enabledType: index('triggers_enabled_type_idx')
      .on(table.type)
      .where(sql`${table.enabled}`),
  }),
);
