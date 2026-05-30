import { pgTable, text, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace';

/**
 * Namespace-scoped secrets (ADR-0001 §1.2).
 * Original Firestore path: namespaces/{handle}/namespaceSecrets/_config.secrets.{key}.
 *
 * Firestore stored every key inside a single `_config` document map. Postgres
 * flattens that to one row per (workspace, key) so writes don't have to
 * read-modify-write the whole map. Values are AES-256-GCM ciphertext from
 * `secrets-cipher`; the repo encrypts on write, decrypts on read.
 */
export const namespaceSecrets = pgTable(
  'namespace_secrets',
  {
    workspace: text('workspace')
      .notNull()
      .references(() => workspaces.handle, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    encryptedValue: text('encrypted_value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspace, table.key] }),
  }),
);
