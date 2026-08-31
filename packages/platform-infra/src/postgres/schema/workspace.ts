import { pgTable, text, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

/**
 * Tenant root. Original Firestore path: namespaces/{handle}.
 *
 * "Workspace" is the canonical name per PLAN-0001 §1.2; the in-code type
 * stays `Namespace` until the follow-up rename PR per PLAN-0001 §4.
 * `handle` is the natural primary key (URL slug, today's doc-id).
 *
 * Members live in a separate table with a composite PK (workspace, uid).
 * The standalone `uid` index replaces the Firestore collectionGroup query
 * used today by `getUserNamespaces`.
 */
export const workspaces = pgTable('workspaces', {
  handle: text('handle').primaryKey(),
  type: text('type').notNull(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  icon: text('icon'),
  logo: text('logo'),
  brandPrimaryColor: text('brand_primary_color'),
  brandAccentColor: text('brand_accent_color'),
  linkedUserId: text('linked_user_id'),
  bio: text('bio'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspace: text('workspace')
      .notNull()
      .references(() => workspaces.handle, { onDelete: 'cascade' }),
    uid: text('uid').notNull(),
    role: text('role').notNull(),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspace, table.uid] }),
    uidIdx: index('workspace_members_uid_idx').on(table.uid),
  }),
);

/**
 * Removals remembered so domain-based auto-join (`AUTO_JOIN_WORKSPACES`)
 * cannot silently undo them — see migration 0043 for why this is its own
 * table rather than a soft-delete flag on `workspaceMembers`.
 *
 * A row is written whenever a member is removed or leaves, and dropped when
 * someone is explicitly added back; both happen in the same transaction as
 * the membership write they accompany.
 */
export const workspaceAutojoinBlocks = pgTable(
  'workspace_autojoin_blocks',
  {
    workspace: text('workspace')
      .notNull()
      .references(() => workspaces.handle, { onDelete: 'cascade' }),
    uid: text('uid').notNull(),
    blockedAt: timestamp('blocked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspace, table.uid] }),
  }),
);
