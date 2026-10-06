import type { SkillFile } from '@mediforce/platform-core';
import { pgTable, text, jsonb, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace';

/**
 * Workspace Skills (ADR-0025): one Claude Code skill folder per row. Composite
 * PK `(workspace, id)` mirrors `tool_catalog_entries`; `id` is the `name` in
 * the skill's `SKILL.md` frontmatter.
 *
 * `files` is jsonb rather than a blob: a skill is at most 256 KB of text, read
 * whole on every step, and one row keeps content, hash and visibility in a
 * single transaction (ADR-0025 decision 2). `name` and `description` are
 * copies of the frontmatter, lifted to columns so a listing never reads
 * `files`.
 */
export const skills = pgTable(
  'skills',
  {
    workspace: text('workspace')
      .notNull()
      .references(() => workspaces.handle, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    visibility: text('visibility').notNull().default('private'),
    contentHash: text('content_hash').notNull(),
    files: jsonb('files').$type<SkillFile[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspace, table.id] }),
  }),
);
