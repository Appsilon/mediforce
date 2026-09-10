import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Authenticated user identity (PLAN-0002 §1.1; keep-uid per ADR-0002 §7).
 *
 * `id` IS the Firebase uid for migrated users (text, never uuid) so every
 * existing reference (`workspace_members.uid`, `*.assigned_user_id`,
 * `created_by`, audit actor) stays valid with no rewrite. New users created
 * after the NextAuth cutover get an adapter-generated uuid via `$defaultFn`
 * below — mixed id shapes are harmless (both are opaque `text`, ADR-0002 §7).
 *
 * `image` keeps the directory's `getUserMetadata` member-list avatar fallback.
 *
 * The NextAuth cutover added (migration 0032) the two remaining
 * `@auth/drizzle-adapter` columns:
 *   - `email_verified` — the adapter's `emailVerified` timestamp.
 *   - `password_hash`  — bcrypt hash, written only for users who set a
 *     password and read by `/api/auth/password-login` (ADR-0002 §4). NextAuth
 *     tolerates the extra column.
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
  // Stamped by `recordSignIn` on every successful sign-in (migration 0033) so
  // the member list can show when someone was last here. Sessions cannot carry
  // this: signing out deletes the row.
  lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true, mode: 'date' }),
  // When an admin deliberately seeded this account — an invite, or a redeemed
  // join link (migration 0048). NULL means self-registered or carried over by
  // the Firebase migration.
  //
  // This is the second term of the ADR-0021 §5 sign-in gate, and it is a column
  // rather than "an `auth_users` row exists" because the adapter writes such a
  // row for every self-registered OAuth user too. Only `seedInvite` sets it, so
  // removing a domain from `ALLOWED_EMAIL_DOMAINS` still evicts the people who
  // signed themselves in at it.
  invitedAt: timestamp('invited_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
