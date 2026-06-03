import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * General platform configuration key-value store (ALERT-03).
 * Keys follow a dot-notation convention: e.g., alert.webhook.url, alert.webhook.type.
 * Deployment-global — no workspace column.
 */
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
