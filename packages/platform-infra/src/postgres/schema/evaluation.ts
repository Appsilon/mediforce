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
  check,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { workspaces } from './workspace';

/**
 * Storage for `EvaluationRepository` (platform-core), which owns the why.
 * Shape notes only:
 *
 * Every table is keyed by what it evaluates, `(workspace, workflow_name,
 * step_id, agent_id)`: a Step's rows leave `agent_id` `''`, an Agent's
 * (ADR-0029) leave `workflow_name` and `step_id` `''` — empty, not null, so the
 * owner stays in the primary keys; `<table>_owner_check` holds exactly one set.
 * No foreign key reaches a Workflow Definition or an Agent — Evaluation lives
 * outside the immutable definition (ADR-0023 D2) and survives its versions.
 * Versioned tables are append-only; `evaluator_versions` takes in-place writes
 * only for `source_approval`, which describes a version without changing what
 * it checks.
 */
const agentIdColumn = () => text('agent_id').notNull().default('');

/** Exactly one owner: a Step (`workflow_name`, `step_id`) or an Agent (`agent_id`). */
const ownerCheck = (name: string, table: { workflowName: AnyPgColumn; stepId: AnyPgColumn; agentId: AnyPgColumn }) =>
  check(name, sql`(${table.agentId} <> '' AND ${table.workflowName} = '' AND ${table.stepId} = '') OR (${table.agentId} = '' AND ${table.workflowName} <> '' AND ${table.stepId} <> '')`);

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
    agentId: agentIdColumn(),
    version: integer('version').notNull(),
    text: text('text').notNull(),
    origin: text('origin').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerCheck: ownerCheck('evaluation_briefs_owner_check', table),
    pk: primaryKey({ columns: [table.workspace, table.workflowName, table.stepId, table.agentId, table.version] }),
  }),
);

export const evaluators = pgTable(
  'evaluators',
  {
    id: uuid('id').primaryKey(),
    workspace: workspaceColumn(),
    workflowName: text('workflow_name').notNull(),
    stepId: text('step_id').notNull(),
    agentId: agentIdColumn(),
    name: text('name').notNull(),
    archived: boolean('archived').notNull().default(false),
    runInProduction: boolean('run_in_production').notNull().default(false),
    onError: text('on_error').notNull().default('ignore'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerCheck: ownerCheck('evaluators_owner_check', table),
    stepNameIdx: uniqueIndex('evaluators_step_name_idx').on(table.workspace, table.workflowName, table.stepId, table.agentId, table.name),
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
    check: jsonb('check').notNull(),
    origin: text('origin').notNull(),
    sourceApproval: jsonb('source_approval'),
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
    agentId: agentIdColumn(),
    name: text('name').notNull(),
    input: jsonb('input').notNull(),
    workspaceSeedCommit: text('workspace_seed_commit'),
    expectation: text('expectation').notNull(),
    expectedOutput: jsonb('expected_output'),
    comparison: text('comparison').notNull().default('exact'),
    agreementInstructions: text('agreement_instructions'),
    evaluatorIds: jsonb('evaluator_ids'),
    source: text('source').notNull(),
    sourceAgentRunId: text('source_agent_run_id'),
    perturbation: jsonb('perturbation'),
    origin: text('origin').notNull().default('user'),
    split: text('split').notNull(),
    containsProductionData: boolean('contains_production_data').notNull(),
    archived: boolean('archived').notNull().default(false),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerCheck: ownerCheck('eval_cases_owner_check', table),
    stepIdx: index('eval_cases_step_idx').on(table.workspace, table.workflowName, table.stepId, table.agentId, table.createdAt.desc()),
  }),
);

export const evalDatasetVersions = pgTable(
  'eval_dataset_versions',
  {
    id: uuid('id').primaryKey(),
    workspace: workspaceColumn(),
    workflowName: text('workflow_name').notNull(),
    stepId: text('step_id').notNull(),
    agentId: agentIdColumn(),
    version: integer('version').notNull(),
    caseIds: jsonb('case_ids').notNull(),
    containsProductionData: boolean('contains_production_data').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerCheck: ownerCheck('eval_dataset_versions_owner_check', table),
    stepVersionIdx: uniqueIndex('eval_dataset_versions_step_version_idx')
      .on(table.workspace, table.workflowName, table.stepId, table.agentId, table.version),
  }),
);

export const mcpEvalPolicies = pgTable(
  'mcp_eval_policies',
  {
    workspace: workspaceColumn(),
    workflowName: text('workflow_name').notNull(),
    stepId: text('step_id').notNull(),
    agentId: agentIdColumn(),
    servers: jsonb('servers').notNull(),
    env: jsonb('env').notNull().default({}),
    updatedBy: text('updated_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerCheck: ownerCheck('mcp_eval_policies_owner_check', table),
    pk: primaryKey({ columns: [table.workspace, table.workflowName, table.stepId, table.agentId] }),
  }),
);

/** Acceptance Criteria per Step, one row per version, like Briefs. */
export const evalAcceptanceCriteria = pgTable(
  'eval_acceptance_criteria',
  {
    workspace: workspaceColumn(),
    workflowName: text('workflow_name').notNull(),
    stepId: text('step_id').notNull(),
    agentId: agentIdColumn(),
    version: integer('version').notNull(),
    criteria: jsonb('criteria').notNull(),
    origin: text('origin').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerCheck: ownerCheck('eval_acceptance_criteria_owner_check', table),
    pk: primaryKey({ columns: [table.workspace, table.workflowName, table.stepId, table.agentId, table.version] }),
  }),
);

/**
 * Eval Runs (ADR-0023 D4, D10). The frozen parts — cases, Evaluator versions,
 * MCP policy, estimate — are written once at prepare; afterwards only
 * `status`, the timestamps and `spent_usd` change, each by a conditional
 * update so concurrent drivers cannot both move a run — and `acceptance`,
 * rewritten whenever the run's grades change.
 */
export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey(),
    workspace: workspaceColumn(),
    workflowName: text('workflow_name').notNull(),
    stepId: text('step_id').notNull(),
    agentId: agentIdColumn(),
    definitionVersion: integer('definition_version'),
    agentVersion: integer('agent_version'),
    suiteAgentId: text('suite_agent_id'),
    datasetVersionId: uuid('dataset_version_id').notNull().references(() => evalDatasetVersions.id),
    caseIds: jsonb('case_ids').notNull(),
    trialsPerCase: integer('trials_per_case').notNull(),
    concurrency: integer('concurrency').notNull(),
    evaluators: jsonb('evaluators').notNull(),
    fingerprint: jsonb('fingerprint'),
    acceptanceCriteria: jsonb('acceptance_criteria'),
    mcpPolicy: jsonb('mcp_policy').notNull(),
    env: jsonb('env').notNull().default({}),
    estimate: jsonb('estimate').notNull(),
    budgetUsd: doublePrecision('budget_usd').notNull(),
    spentUsd: doublePrecision('spent_usd').notNull().default(0),
    status: text('status').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    acceptance: jsonb('acceptance'),
  },
  (table) => ({
    ownerCheck: ownerCheck('eval_runs_owner_check', table),
    stepIdx: index('eval_runs_step_idx').on(table.workspace, table.workflowName, table.stepId, table.agentId, table.createdAt.desc()),
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
    /** Legacy (ADR-0024), from when a run could hold challengers; every trial is the step's own. */
    variantId: text('variant_id').notNull().default('champion'),
    trialIndex: integer('trial_index').notNull(),
    status: text('status').notNull(),
    processInstanceId: text('process_instance_id'),
    agentRunId: text('agent_run_id'),
    costUsd: doublePrecision('cost_usd'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    durationMs: integer('duration_ms'),
    confidence: doublePrecision('confidence'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    scoringStartedAt: timestamp('scoring_started_at', { withTimezone: true }),
    scoringAttempts: integer('scoring_attempts').notNull().default(0),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    mcpReplayMisses: jsonb('mcp_replay_misses').notNull().default([]),
    erroredJudgeCalls: jsonb('errored_judge_calls').notNull().default({}),
  },
  (table) => ({
    runIdx: index('eval_trials_run_idx').on(table.evalRunId, table.caseId, table.variantId, table.trialIndex),
    instanceIdx: uniqueIndex('eval_trials_instance_idx').on(table.processInstanceId),
  }),
);

/**
 * What a live trial's MCP server answered (ADR-0023 D6): insert-only, one row
 * per trial and server, read back by case and server for a replay.
 */
export const evalMcpRecordings = pgTable(
  'eval_mcp_recordings',
  {
    id: uuid('id').primaryKey(),
    workspace: workspaceColumn(),
    workflowName: text('workflow_name').notNull(),
    stepId: text('step_id').notNull(),
    agentId: agentIdColumn(),
    caseId: uuid('case_id').notNull(),
    server: text('server').notNull(),
    tape: jsonb('tape').notNull(),
    evalRunId: uuid('eval_run_id').notNull().references(() => evalRuns.id, { onDelete: 'cascade' }),
    trialId: uuid('trial_id').notNull().references(() => evalTrials.id, { onDelete: 'cascade' }),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerCheck: ownerCheck('eval_mcp_recordings_owner_check', table),
    caseIdx: index('eval_mcp_recordings_case_idx')
      .on(table.workspace, table.workflowName, table.stepId, table.agentId, table.caseId, table.server, table.recordedAt),
  }),
);

/**
 * Signed Step Qualifications (ADR-0023 D10, D11): insert-only. The signed
 * record is `record` whole; the columns beside it are what the Step's badge
 * and history are looked up by.
 */
export const stepQualifications = pgTable(
  'step_qualifications',
  {
    id: uuid('id').primaryKey(),
    workspace: workspaceColumn(),
    workflowName: text('workflow_name').notNull(),
    stepId: text('step_id').notNull(),
    agentId: agentIdColumn(),
    evalRunId: uuid('eval_run_id').notNull().references(() => evalRuns.id),
    fingerprint: text('fingerprint').notNull(),
    record: jsonb('record').notNull(),
    signedBy: text('signed_by').notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    ownerCheck: ownerCheck('step_qualifications_owner_check', table),
    stepIdx: index('step_qualifications_step_idx').on(table.workspace, table.workflowName, table.stepId, table.agentId, table.signedAt.desc()),
    runUnique: uniqueIndex('step_qualifications_eval_run_uniq').on(table.evalRunId),
  }),
);
