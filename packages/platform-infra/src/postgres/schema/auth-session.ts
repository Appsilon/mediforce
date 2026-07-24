import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core';
import { authUsers } from './auth-user';

/**
 * Database-strategy session rows (PLAN-0002 §1.1; ADR-0002 §3 —
 * `session: 'database'`).
 * Required by `@auth/drizzle-adapter`: `createSession` / `getSessionAndUser` /
 * `updateSession` / `deleteSession`.
 *
 * The `session_token` is carried verbatim in the NextAuth httpOnly session
 * cookie (database strategy — the cookie value IS the token, not a JWE), so
 * `resolveSessionUserId` looks a request up by this column. Deleting a row (or
 * letting `expires` lapse) revokes the session on the next request (ADR-0002
 * §3, immediate server-side revocation).
 *
 * Property names (`sessionToken`, `userId`, `expires`) match the adapter's
 * schema contract exactly and must not be renamed.
 */
export const authSessions = pgTable(
  'auth_sessions',
  {
    sessionToken: text('session_token').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    expires: timestamp('expires', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => ({
    userIdIdx: index('auth_sessions_user_id_idx').on(table.userId),
    expiresIdx: index('auth_sessions_expires_idx').on(table.expires),
  }),
);
