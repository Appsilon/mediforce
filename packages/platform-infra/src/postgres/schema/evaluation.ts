import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  doublePrecision,
  jsonb,
  timestamp,
  index,
  primaryKey,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { workspaces } from './workspace';

/**
 * Storage for `EvaluationRepository` (platform-core), which owns the why.
 * Shape notes only:
 *
 * Every table is keyed by the Step it evaluates, `(workspace, workflow_name,
 * step_id)`, with no foreign key to a Workflow Definition — Evaluation lives
 * outside the immutable definition (ADR-0023 D2) and survives its versions.
 * Versioned tables are append-only; `evaluator_versions` takes in-place writes
 * only for `source_approval` and `calibration`, which describe a version
 * without changing what it checks.
 */
const workspaceColumn = () =>
  text('workspace')
    .notNull()
    .references(() => workspaces.handle, { onDelete: 'cascade' });

export const evaluationBriefs = pgTable(
  'evaluation_briefs',
  {
    workspace: workspaceColumn(),
    workflowName: text('workflow_name').notNull(),
    stepId: text('step_id').notNull(),
    version: integer('version').notNull(),
    text: text('text').notNull(),
    origin: text('origin').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspace, table.workflowName, table.stepId, table.version] }),
  }),
);

export const evaluators = pgTable(
  'evaluators',
  {
    id: uuid('id').primaryKey(),
    workspace: workspaceColumn(),
    workflowName: text('workflow_name').notNull(),
    stepId: text('step_id').notNull(),
    name: text('name').notNull(),
    archived: boolean('archived').notNull().default(false),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    stepNameIdx: uniqueIndex('evaluators_step_name_idx').on(table.workspace, table.workflowName, table.stepId, table.name),
  }),
);

export const evaluatorVersions = pgTable(
  'evaluator_versions',
  {
    evaluatorId: uuid('evaluator_id')
      .notNull()
      .references(() => evaluators.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    rule: text('rule').notNull(),
    severity: text('severity').notNull(),
    check: jsonb('check').notNull(),
    origin: text('origin').notNull(),
    sourceApproval: jsonb('source_approval'),
    calibration: jsonb('calibration'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.evaluatorId, table.version] }),
  }),
);

export const evalCases = pgTable(
  'eval_cases',
  {
    id: uuid('id').primaryKey(),
    workspace: workspaceColumn(),
    workflowName: text('workflow_name').notNull(),
    stepId: text('step_id').notNull(),
    name: text('name').notNull(),
    input: jsonb('input').notNull(),
    workspaceSeedCommit: text('workspace_seed_commit'),
    expectation: text('expectation').notNull(),
    notes: text('notes'),
    source: text('source').notNull(),
    sourceAgentRunId: text('source_agent_run_id'),
    split: text('split').notNull(),
    containsProductionData: boolean('contains_production_data').notNull(),
    archived: boolean('archived').notNull().default(false),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    stepIdx: index('eval_cases_step_idx').on(table.workspace, table.workflowName, table.stepId, table.createdAt.desc()),
  }),
);

export const evalDatasetVersions = pgTable(
  'eval_dataset_versions',
  {
    id: uuid('id').primaryKey(),
    workspace: workspaceColumn(),
    workflowName: text('workflow_name').notNull(),
    stepId: text('step_id').notNull(),
    version: integer('version').notNull(),
    caseIds: jsonb('case_ids').notNull(),
    containsProductionData: boolean('contains_production_data').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    stepVersionIdx: uniqueIndex('eval_dataset_versions_step_version_idx')
      .on(table.workspace, table.workflowName, table.stepId, table.version),
  }),
);

export const mcpEvalPolicies = pgTable(
  'mcp_eval_policies',
  {
    workspace: workspaceColumn(),
    workflowName: text('workflow_name').notNull(),
    stepId: text('step_id').notNull(),
    servers: jsonb('servers').notNull(),
    updatedBy: text('updated_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspace, table.workflowName, table.stepId] }),
  }),
);

/**
 * Eval Runs (ADR-0023 D4, D10). The frozen parts — cases, Evaluator versions,
 * MCP policy, estimate — are written once at prepare; afterwards only
 * `status`, the timestamps and `spent_usd` change, each by a conditional
 * update so concurrent drivers cannot both move a run.
 */
export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey(),
    workspace: workspaceColumn(),
    workflowName: text('workflow_name').notNull(),
    stepId: text('step_id').notNull(),
    definitionVersion: integer('definition_version').notNull(),
    datasetVersionId: uuid('dataset_version_id').notNull().references(() => evalDatasetVersions.id),
    caseIds: jsonb('case_ids').notNull(),
    trialsPerCase: integer('trials_per_case').notNull(),
    concurrency: integer('concurrency').notNull(),
    evaluators: jsonb('evaluators').notNull(),
    mcpPolicy: jsonb('mcp_policy').notNull(),
    estimate: jsonb('estimate').notNull(),
    budgetUsd: doublePrecision('budget_usd').notNull(),
    spentUsd: doublePrecision('spent_usd').notNull().default(0),
    status: text('status').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    stepIdx: index('eval_runs_step_idx').on(table.workspace, table.workflowName, table.stepId, table.createdAt.desc()),
    statusIdx: index('eval_runs_status_idx').on(table.status),
  }),
);

/** One trial of an Eval Run: one case, one repetition, one single-step Workflow Run. */
export const evalTrials = pgTable(
  'eval_trials',
  {
    id: uuid('id').primaryKey(),
    evalRunId: uuid('eval_run_id').notNull().references(() => evalRuns.id, { onDelete: 'cascade' }),
    caseId: uuid('case_id').notNull(),
    trialIndex: integer('trial_index').notNull(),
    status: text('status').notNull(),
    processInstanceId: text('process_instance_id'),
    agentRunId: text('agent_run_id'),
    costUsd: doublePrecision('cost_usd'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    durationMs: integer('duration_ms'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    scoringStartedAt: timestamp('scoring_started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    runIdx: index('eval_trials_run_idx').on(table.evalRunId, table.caseId, table.trialIndex),
    instanceIdx: uniqueIndex('eval_trials_instance_idx').on(table.processInstanceId),
  }),
);
