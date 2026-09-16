import { pgTable, text, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace';

/**
 * Storage for `WorkflowAssistantInstructionsRepository` (platform-core), which
 * owns the why. Shape notes only:
 *
 * Its own table rather than a column on `workspace_members`, because that row
 * is returned to every member by the member list. No `uid` foreign key, also
 * matching `workspace_members`: identity lives in `auth_users` and membership
 * rows do not reference it either.
 */
export const workflowAssistantInstructions = pgTable(
  'workflow_assistant_instructions',
  {
    workspace: text('workspace')
      .notNull()
      .references(() => workspaces.handle, { onDelete: 'cascade' }),
    uid: text('uid').notNull(),
    instructions: text('instructions').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspace, table.uid] }),
  }),
);
