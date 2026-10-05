import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  doublePrecision,
  jsonb,
  timestamp,
  index,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { workspaces } from './workspace';

/**
 * Storage for `ScoreRepository` (platform-core), which owns the why. Shape
 * notes only:
 *
 * `subject` is flattened to `(subject_type, subject_id)`; no foreign key to
 * `agent_runs` or `process_instances` because the subject is polymorphic. The
 * correlation columns are denormalised on write so a Score list never joins.
 * Append-only: nothing updates a row.
 */
export const scores = pgTable(
  'scores',
  {
    id: uuid('id').primaryKey(),
    workspace: text('workspace')
      .notNull()
      .references(() => workspaces.handle, { onDelete: 'cascade' }),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    name: text('name').notNull(),
    value: doublePrecision('value').notNull(),
    label: text('label'),
    comment: text('comment'),
    source: text('source').notNull(),
    createdBy: text('created_by'),
    metadata: jsonb('metadata'),
    processInstanceId: text('process_instance_id'),
    stepId: text('step_id'),
    evaluatorId: text('evaluator_id'),
    supersedes: uuid('supersedes').references((): AnyPgColumn => scores.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    subjectIdx: index('scores_subject_idx').on(table.subjectType, table.subjectId, table.createdAt.desc()),
    workspaceCreatedIdx: index('scores_workspace_created_idx').on(table.workspace, table.createdAt.desc()),
    instanceStepIdx: index('scores_instance_step_idx').on(table.processInstanceId, table.stepId),
    valueRange: check('scores_value_range', sql`${table.value} >= 0 AND ${table.value} <= 1`),
  }),
);
