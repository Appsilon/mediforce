import { pgTable, text, jsonb, timestamp, primaryKey } from 'drizzle-orm/pg-core';

/**
 * Curated MCP server catalog (stdio and HTTP), scoped per workspace.
 * `type` selects the populated columns: stdio rows carry command/args/env,
 * http rows carry url/auth.
 * Original Firestore path: namespaces/{handle}/toolCatalog/{entryId}
 * Composite PK (workspace, id) keeps the per-workspace entry-id uniqueness
 * that Firestore enforced via document paths.
 */
export const toolCatalogEntries = pgTable(
  'tool_catalog_entries',
  {
    workspace: text('workspace').notNull(),
    id: text('id').notNull(),
    type: text('type').$type<'stdio' | 'http'>().notNull().default('stdio'),
    command: text('command'),
    args: jsonb('args').$type<string[] | null>(),
    env: jsonb('env').$type<Record<string, string> | null>(),
    url: text('url'),
    auth: jsonb('auth'),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspace, table.id] }),
  }),
);
