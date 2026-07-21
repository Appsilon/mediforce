import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Authenticated user identity (ADR-0002 §1.1, keep-uid §7).
 *
 * `id` IS the Firebase uid for migrated users (text, never uuid) so every
 * existing reference (`workspace_members.uid`, `*.assigned_user_id`,
 * `created_by`, audit actor) stays valid with no rewrite. New users created
 * after the NextAuth cutover get an adapter-generated uuid via `$defaultFn`
 * below — mixed id shapes are harmless (both are opaque `text`, ADR-0002 §7).
 *
 * `image` keeps the directory's `getUserMetadata` member-list avatar fallback.
 *
 * PR2 (NextAuth cutover) ALTERs this table (migration 0030) to add the two
 * remaining `@auth/drizzle-adapter` columns:
 *   - `email_verified` — the adapter's `emailVerified` timestamp.
 *   - `password_hash`  — bcrypt hash, only set when the Credentials provider
 *     is used (ADR-0002 §4). NextAuth tolerates the extra column.
 *
 * The property names (`emailVerified`) match the `@auth/drizzle-adapter`
 * schema contract exactly — the adapter references `usersTable.emailVerified`
 * by property, so it must not be renamed.
 */
export const authUsers = pgTable('auth_users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull().unique(),
  name: text('name'),
  emailVerified: timestamp('email_verified', { withTimezone: true, mode: 'date' }),
  image: text('image'),
  passwordHash: text('password_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
