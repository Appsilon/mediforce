import { pgTable, text, timestamp, primaryKey } from 'drizzle-orm/pg-core';

/**
 * Verification tokens (PLAN-0002 §1.1). Required by the `@auth/drizzle-adapter`
 * schema contract even though the MVP defers the Email (magic-link) provider
 * (ADR-0002 §4) — the table is never written until that provider is enabled,
 * but the adapter needs the drizzle object to construct.
 *
 * Property names (`identifier`, `token`, `expires`) match the adapter contract.
 */
export const authVerificationTokens = pgTable(
  'auth_verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.identifier, table.token] }),
  }),
);
