import { pgTable, text, integer, timestamp, primaryKey, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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

/**
 * Join links (ADR-0021): a secret an admin mints once and hands to a room, a
 * slide, or a QR code. Redeeming one grants Membership in `workspace` — it
 * never opens a session, so only the `token_hash` is stored and the plaintext
 * is unrecoverable after creation.
 *
 * Deliberately not `authVerificationTokens`: those are single-use and bound to
 * one identifier, which is the opposite of what a link handed to a cohort is.
 *
 * No `membership` column: a link always grants `member` (ADR-0021 §3), so the
 * seat is not a dimension of the link and is not stored as one.
 */
export const workspaceJoinLinks = pgTable(
  'workspace_join_links',
  {
    id: text('id').primaryKey(),
    workspace: text('workspace')
      .notNull()
      .references(() => workspaces.handle, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** `null` = uncapped; the expiry is then the only limit. */
    maxUses: integer('max_uses'),
    uses: integer('uses').notNull().default(0),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    workspaceIdx: index('workspace_join_links_workspace_idx').on(table.workspace),
    // Declared here as well as in migration 0047 so `drizzle-kit generate` does
    // not read it as drift and re-emit the DDL.
    maxUsesCheck: check(
      'workspace_join_links_max_uses_check',
      sql`${table.maxUses} IS NULL OR ${table.maxUses} > 0`,
    ),
  }),
);
