import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Authenticated user identity (ADR-0002 §1.1, keep-uid §7).
 *
 * PR1 ships a deliberately MINIMAL subset: only the columns the PG
 * `UserDirectoryService` needs to return `{ uid, email, displayName }` once
 * Firebase Auth stops being read for the directory. `id` IS the Firebase uid
 * (text, never uuid) so every existing reference (`workspace_members.uid`,
 * `*.assigned_user_id`, `created_by`, audit actor) stays valid with no rewrite.
 *
 * `image` is included now (not deferred) so the directory's `getUserMetadata`
 * keeps returning the member-list avatar fallback — dropping it would be a
 * silent regression. `lastSignInTime` has no PG source until NextAuth sessions
 * land (PR2), so the directory returns it as `null` in PR1.
 *
 * PR2 (NextAuth cutover) ALTERs this table to add the remaining
 * `@auth/drizzle-adapter` columns (`email_verified`, `password_hash`) — it
 * must ALTER, not CREATE, because PR1 already created the table.
 */
export const authUsers = pgTable('auth_users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
