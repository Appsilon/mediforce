import {
  pgTable,
  text,
  uuid,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { workspaces } from './workspace.js';

/**
 * Agent → human handoff entity (PLAN-0001 §1.2 handoff_entities).
 *
 * Soft-mutable: status transitions created → acknowledged → resolved. Carries
 * `updated_at` + a `set_updated_at` trigger mirroring the Firestore impl
 * which writes `updatedAt` on every mutation.
 *
 * NO soft-delete column — handoffs are never tombstoned in Firestore.
 *
 * The `workspace` column is derived at insert time from the parent
 * ProcessInstance — HandoffEntity itself carries no namespace field. Same
 * pattern as audit_events, agent_runs and human_tasks.
 *
 * `process_instance_id` is `text` not `uuid` — process_instances retains
 * Firestore-style string ids during dual-code (see commit 48294005); stays
 * text post-cutover so no later conversion is needed.
 *
 * `agent_run_id` is also `text` (not FK to agent_runs.id) for the same
 * dual-code reason: today it holds workflow-engine-generated strings (often
 * literal `'unknown'`); adding an FK would gratuitously break legacy data
 * and forces a parent-row precondition the Firestore impl never enforced.
 * Matches the audit/agent-run/human-task pattern of skipping FKs to
 * Firestore-shaped ids during dual-code.
 */
export const handoffEntities = pgTable(
  'handoff_entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspace: text('workspace')
      .notNull()
      .references(() => workspaces.handle, { onDelete: 'cascade' }),

    type: text('type').notNull(),
    processInstanceId: text('process_instance_id').notNull(),
    stepId: text('step_id').notNull(),
    agentRunId: text('agent_run_id').notNull(),

    assignedRole: text('assigned_role').notNull(),
    assignedUserId: text('assigned_user_id'),
    status: text('status').notNull(),

    agentWork: jsonb('agent_work'),
    agentReasoning: text('agent_reasoning'),
    agentQuestion: text('agent_question'),

    payload: jsonb('payload'),
    resolution: jsonb('resolution'),

    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Workspace-scoped inbox feed: most reads start here.
    workspaceStatusIdx: index('handoff_entities_workspace_status_idx').on(
      table.workspace,
      table.status,
      table.createdAt,
    ),
    // Role queue across all workspaces (system actor reads).
    roleStatusIdx: index('handoff_entities_role_status_idx').on(
      table.assignedRole,
      table.status,
    ),
  }),
);
