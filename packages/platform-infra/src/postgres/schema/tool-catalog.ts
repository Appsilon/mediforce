import { pgTable, text, jsonb, timestamp, primaryKey } from 'drizzle-orm/pg-core';

/**
 * Admin-curated stdio MCP server catalog, scoped per workspace.
 * Original Firestore path: namespaces/{handle}/toolCatalog/{entryId}
 * Composite PK (workspace, id) keeps the per-workspace entry-id uniqueness
 * that Firestore enforced via document paths.
 */
export const toolCatalogEntries = pgTable(
  'tool_catalog_entries',
  {
    workspace: text('workspace').notNull(),
    id: text('id').notNull(),
    command: text('command').notNull(),
    args: jsonb('args').$type<string[] | null>(),
    env: jsonb('env').$type<Record<string, string> | null>(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspace, table.id] }),
  }),
);
