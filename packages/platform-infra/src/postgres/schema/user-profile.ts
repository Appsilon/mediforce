import { pgTable, text, boolean, timestamp } from 'drizzle-orm/pg-core';

/**
 * Mediforce-side per-user profile fields (ADR-0001 final cutover, #534).
 * Original Firestore path: users/{uid}.
 *
 * Minimal by design: the only application-owned field anything reads live is
 * `mustChangePassword`. Identity fields (email, displayName, image) come from
 * `auth_users` via `UserDirectoryService`; handle/roles/organizations come
 * from `namespace_members`. The other legacy `users` doc fields were
 * dead pre-Phase-4 duplicates and are not carried over.
 *
 * Keyed by `uid` (`auth_users.id`, which for migrated users IS the old
 * Firebase uid — ADR-0002 §7) — no workspace column, the profile is global to
 * the user.
 */
export const userProfiles = pgTable('user_profiles', {
  uid: text('uid').primaryKey(),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
