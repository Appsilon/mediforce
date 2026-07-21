import { pgTable, text, integer, primaryKey } from 'drizzle-orm/pg-core';
import { authUsers } from './auth-user';

/**
 * OAuth / OIDC account links (PLAN-0002 §1.1). Required by
 * `@auth/drizzle-adapter`: `linkAccount` / `getUserByAccount` / `unlinkAccount`
 * read and write this table.
 *
 * Column PROPERTY names (`userId`, `providerAccountId`, `refresh_token`, …)
 * match the adapter's schema contract exactly — the adapter references them by
 * property, so they must not be renamed. DB column names stay snake_case.
 *
 * `provider === 'google'` links a migration-seeded user by verified email
 * (ADR-0002 §4b, `allowDangerousEmailAccountLinking` on the Google provider).
 */
export const authAccounts = pgTable(
  'auth_accounts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.provider, table.providerAccountId] }),
  }),
);
