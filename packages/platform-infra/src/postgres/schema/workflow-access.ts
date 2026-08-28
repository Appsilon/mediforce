import { pgTable, text, jsonb, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace';

/**
 * Who may run and who may edit one workflow (ADR-0019; issue #1253).
 *
 * A side table keyed by `(workspace, name)` rather than a field on the
 * versioned `workflow_definitions` row: registering v8 must not silently
 * rewrite permissions, and `WorkflowAuthorableSchema` is what the design LLM
 * emits, so a field there is a field it can write. (`visibility` *is* on the
 * definition and authorable — it is the counter-example, not the precedent.)
 * `(workspace, name)` is also the only key that matches how the verbs behave:
 * deleting a workflow revokes access to every version of it at once.
 *
 * Both lists hold process-domain Role names (`user_roles.role`), never uids:
 * a single-member role expresses "only this person" without a second
 * mechanism. Neither is a foreign key — roles are free-form strings by
 * construction, so gating on a role nobody has been granted yet is a
 * legitimate authoring order, not a broken reference.
 *
 * A row exists only while it grants something. `setWorkflowAccess` deletes it
 * once both lists are empty, so "open to every workspace member" — the
 * pre-gate behaviour and the state of every workflow that has never opened the
 * Access tab — has exactly one representation. That is also what makes the
 * delete and transfer cascades a plain write rather than a second code path.
 *
 * `name` deliberately has no foreign key, for the reason `user_roles` gives:
 * a workflow is `(namespace, name)` across all its versions, so there is no
 * single row to point at. The cascade is done in the `deleteWorkflow` and
 * `transferWorkflowNamespace` handlers — the two events that put the name back
 * in circulation, and the same two that clear narrowed role grants.
 */
export const workflowAccess = pgTable(
  'workflow_access',
  {
    workspace: text('workspace')
      .notNull()
      .references(() => workspaces.handle, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Role names allowed to start a run. Empty/absent means any member. */
    runRoles: jsonb('run_roles').notNull().default([]),
    /** Role names allowed to change the workflow. Empty/absent means any member. */
    editRoles: jsonb('edit_roles').notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspace, table.name] }),
  }),
);
