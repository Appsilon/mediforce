import { pgTable, text, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace.js';

/**
 * Workflow-scoped secrets (ADR-0001 §1.2, PR2).
 * Original Firestore path: namespaces/{handle}/workflowSecrets/{workflowName}.secrets.{key}.
 *
 * Flattened to one row per (workspace, workflow_name, key). Values are
 * AES-256-GCM ciphertext from `secrets-cipher`. Precedence (workflow wins
 * over namespace on key collision) lives in the service layer above — both
 * tables just store rows.
 */
export const workflowSecrets = pgTable(
  'workflow_secrets',
  {
    workspace: text('workspace')
      .notNull()
      .references(() => workspaces.handle, { onDelete: 'cascade' }),
    workflowName: text('workflow_name').notNull(),
    key: text('key').notNull(),
    encryptedValue: text('encrypted_value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspace, table.workflowName, table.key] }),
  }),
);
