import { pgTable, text, index, unique } from 'drizzle-orm/pg-core';
import { authUsers } from './auth-user';
import { workspaces } from './workspace';

/**
 * Process-domain roles, held WITHIN a workspace (ADR-0019; issue #1248).
 *
 * Replaces the deployment-global `(uid, role)` table ADR-0002 §5 chose, which
 * made holding `reviewer` in one workspace make you a reviewer in all of them.
 * `namespace` is the workspace the grant lives in; `workflow_name` narrows it
 * to a single workflow, and `NULL` — the default — means *every workflow in
 * the workspace*.
 *
 * `workflow_name` deliberately has no foreign key: a workflow is identified by
 * `(namespace, name)` across every version, so there is no single row to point
 * at. The cascade it would have bought is done explicitly in the
 * `deleteWorkflow` handler, and the membership cascade in
 * `removeMemberWithOrganizations` — both matter because a surviving grant is
 * invisible until the name (or the person) comes back.
 *
 * Uniqueness is `NULLS NOT DISTINCT` (Postgres 15+) so two workspace-wide
 * grants of the same role collapse to one row; a plain UNIQUE would treat
 * every NULL as distinct and let duplicates pile up. It is not a primary key
 * because a PK cannot span a nullable column.
 *
 * Two indexes: `role` still serves the deployment-wide read, and
 * `(namespace, role)` serves `getUsersByRoleInNamespace` — the query every
 * notification and every role check runs.
 */
export const userRoles = pgTable(
  'user_roles',
  {
    uid: text('uid')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    namespace: text('namespace')
      .notNull()
      .references(() => workspaces.handle, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    workflowName: text('workflow_name'),
  },
  (table) => ({
    grantUnique: unique('user_roles_uid_namespace_role_workflow_name_unique')
      .on(table.uid, table.namespace, table.role, table.workflowName)
      .nullsNotDistinct(),
    roleIdx: index('user_roles_role_idx').on(table.role),
    namespaceRoleIdx: index('user_roles_namespace_role_idx').on(table.namespace, table.role),
  }),
);
