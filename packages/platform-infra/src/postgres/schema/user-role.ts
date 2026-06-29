import { pgTable, text, primaryKey, index } from 'drizzle-orm/pg-core';
import { authUsers } from './auth-user';

/**
 * Global process-domain roles (ADR-0002 §1.4, §5).
 *
 * Replaces Firebase `customClaims.roles: string[]`. Global, NOT
 * workspace-scoped: `getUsersByRole(role)` is a deployment-wide query with no
 * namespace context (workflow-engine escalation-notification targeting). A
 * global table is the faithful port — scoping to a workspace would silently
 * change notification targeting, a regression.
 *
 * The index on `role` serves `getUsersByRole(role)` ("all reviewers in the
 * deployment").
 */
export const userRoles = pgTable(
  'user_roles',
  {
    uid: text('uid')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.uid, table.role] }),
    roleIdx: index('user_roles_role_idx').on(table.role),
  }),
);
