import { pgTable, uuid, integer, jsonb, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { agentRuns } from './agent-run';

/**
 * Storage for `AgentTrajectoryRepository` (platform-core), which owns the why.
 * Shape notes only:
 *
 * One row per entry rather than a jsonb array on `agent_runs`, so the runner's
 * batched appends are inserts, not rewrites of an ever-growing document. No
 * `workspace` column: reads are keyed by `agent_run_id` and scope through the
 * parent `agent_runs.workspace`. `entry` holds the entry minus `seq`, already
 * redacted when content capture was off.
 */
export const agentTrajectoryEntries = pgTable(
  'agent_trajectory_entries',
  {
    agentRunId: uuid('agent_run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    entry: jsonb('entry').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.agentRunId, table.seq] }),
  }),
);
