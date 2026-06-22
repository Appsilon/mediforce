import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  jsonb,
  timestamp,
  numeric,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { workspaces } from './workspace';

/**
 * Process instance — the central running-workflow record (PLAN-0001 §1.2
 * process_instances + step_executions + agent_events).
 *
 * Soft-mutable: status transitions created → running → paused | completed |
 * failed plus in-place updates to `variables` (the accumulator) and
 * `current_step_id`. Carries `updated_at` + a `set_updated_at` trigger
 * mirroring the Firestore impl which writes `updatedAt` on every mutation.
 *
 * `id` is `text` not `uuid` so cutover preserves Firestore document ids
 * verbatim (Firestore-generated ids aren't UUID-shaped, and the existing
 * FK columns in audit_events / agent_runs / human_tasks / handoff_entities
 * / cowork_sessions are already `text` — see commit e354e1ce). Stays text
 * post-cutover — no later conversion needed.
 *
 * The `workspace` column mirrors the `namespace` field on the ProcessInstance
 * Zod schema: the repo derives it from `instance.namespace` on insert.
 *
 * The `workflow_definitions` FK is NOT enforced here — that table arrives
 * in §5.2 #11. Until then `(definition_name, definition_version)` is just a
 * data pair.
 *
 * `previous_run_source_id` is a self-FK to `process_instances.id`. It's
 * `text` matching the PK type. ON DELETE SET NULL so deleting a predecessor
 * doesn't cascade-kill its successor; the carry-over snapshot already lives
 * in `previous_run`.
 *
 * Partial indexes exclude tombstoned + archived rows so the hot list
 * queries (workspace inbox + per-definition feed) stay narrow.
 */
export const processInstances = pgTable(
  'process_instances',
  {
    id: text('id').primaryKey(),
    workspace: text('workspace')
      .notNull()
      .references(() => workspaces.handle, { onDelete: 'cascade' }),

    definitionName: text('definition_name').notNull(),
    definitionVersion: text('definition_version').notNull(),

    status: text('status').notNull(), // created | running | paused | completed | failed
    currentStepId: text('current_step_id'),

    // Accumulator — read / written whole.
    variables: jsonb('variables').notNull().default({}),

    triggerType: text('trigger_type').notNull(), // manual | webhook | cron
    triggerPayload: jsonb('trigger_payload'),

    pauseReason: text('pause_reason'),
    error: text('error'),

    assignedRoles: text('assigned_roles').array(),

    // Carry-over from predecessor run (per WD inputForNextRun).
    previousRun: jsonb('previous_run'),
    previousRunSourceId: text('previous_run_source_id').references((): AnyPgColumn => processInstances.id, {
      onDelete: 'set null',
    }),

    totalCostUsd: numeric('total_cost_usd', { precision: 12, scale: 6 }),
    createdBy: text('created_by'),

    dryRun: boolean('dry_run').notNull().default(false),

    // Tombstones — null when not set.
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Workspace inbox: most reads start here (only live rows).
    workspaceStatusIdx: index('process_instances_workspace_status_idx')
      .on(table.workspace, table.status, table.createdAt.desc())
      .where(sql`${table.deletedAt} is null and ${table.archivedAt} is null`),
    // Per-definition feed (status-filtered, newest activity first).
    workspaceDefStatusIdx: index('process_instances_workspace_def_status_idx')
      .on(table.workspace, table.definitionName, table.status, table.updatedAt.desc())
      .where(sql`${table.deletedAt} is null and ${table.archivedAt} is null`),
  }),
);

/**
 * Step execution — one attempt of one step within a process instance.
 *
 * Polymorphic `output` (and `agent_output` snapshot) live as jsonb. The
 * step-executor mints `id` (Firestore auto-id today, caller-supplied
 * crypto.randomUUID() under Postgres). `(process_instance_id, step_id,
 * iteration_number)` reads like a logical key but isn't a constraint —
 * iteration_number may collide briefly during failure/retry windows; the
 * step-executor reconciles via `getLatestStepExecution`.
 *
 * No `updated_at` / `set_updated_at` trigger — updates are targeted
 * (status / output / error transitions during a run); `started_at` +
 * `completed_at` already record the relevant timestamps.
 */
export const stepExecutions = pgTable(
  'step_executions',
  {
    id: text('id').primaryKey(),
    processInstanceId: text('process_instance_id')
      .notNull()
      .references(() => processInstances.id, { onDelete: 'cascade' }),
    stepId: text('step_id').notNull(),

    status: text('status').notNull(),
    iterationNumber: integer('iteration_number').notNull().default(1),

    input: jsonb('input'),
    output: jsonb('output'),
    verdict: text('verdict'),
    gateResult: jsonb('gate_result'),
    error: text('error'),

    reviewVerdicts: jsonb('review_verdicts'),
    agentOutput: jsonb('agent_output'),

    executedBy: text('executed_by'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Per-instance, per-step history (latest-first via `desc`).
    instanceStepStartedIdx: index('step_executions_instance_step_started_idx').on(
      table.processInstanceId,
      table.stepId,
      table.startedAt.desc(),
    ),
  }),
);

/**
 * Agent event — append-only log of agent emits during a step execution.
 *
 * Written by PostgresAgentEventLog (platform-infra) via
 * PostgresProcessInstanceRepository.addAgentEvent.
 *
 * `id` is caller-supplied text — PostgresAgentEventLog mints
 * `crypto.randomUUID()`. `sequence` is `bigint` per PLAN §1.2 since
 * timestamps alone aren't reliable ordering across distributed emitters.
 *
 * No `updated_at` / trigger — append-only.
 */
export const agentEvents = pgTable(
  'agent_events',
  {
    id: text('id').primaryKey(),
    processInstanceId: text('process_instance_id')
      .notNull()
      .references(() => processInstances.id, { onDelete: 'cascade' }),
    stepId: text('step_id').notNull(),

    type: text('type').notNull(),
    payload: jsonb('payload'),
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  },
  (table) => ({
    instanceStepSequenceIdx: index('agent_events_instance_step_sequence_idx').on(
      table.processInstanceId,
      table.stepId,
      table.sequence,
    ),
  }),
);
