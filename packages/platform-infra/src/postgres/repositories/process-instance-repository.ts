import { and, asc, count, desc, eq, gt, inArray, isNull, lt, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import {
  ProcessInstanceSchema,
  StepExecutionSchema,
  AgentEventSchema,
  RunNameEntrySchema,
  parseRow,
  encodeProcessInstanceCursor,
  decodeProcessInstanceCursor,
  type ProcessInstance,
  type ProcessInstanceRepository,
  type InstanceStatus,
  type StepExecution,
  type AgentEvent,
  type ListInstancesOptions,
  type ListInstancesPageOptions,
  type ListInstancesPage,
  type WorkflowDisplayStatus,
  type WorkflowDisplayStatusCounts,
  type WorkflowRunSummaryResult,
  type RunNameEntry,
} from '@mediforce/platform-core';
import type { Database } from '../client';
import {
  processInstances,
  stepExecutions,
  agentEvents,
} from '../schema/process-instance';

const ACTIVE_STATUSES: readonly InstanceStatus[] = ['running', 'created', 'paused'];
const NON_TERMINAL_STATUSES: readonly InstanceStatus[] = ['running', 'created', 'paused'];

// Mirrors getWorkflowStatus's branching (packages/platform-core/src/utils/
// workflow-status.ts) as a SQL condition per bucket — hand-ported, kept in
// sync manually. Any change to that function's branching must be applied
// here too.
const WAITING_FOR_HUMAN_PAUSE_REASONS = [
  'waiting_for_human',
  'awaiting_agent_approval',
  'cowork_in_progress',
  'agent_escalated',
  'agent_paused',
] as const;

function displayStatusConditions(): Record<WorkflowDisplayStatus, SQL> {
  const paused = eq(processInstances.status, 'paused');
  const failed = eq(processInstances.status, 'failed');
  return {
    completed: eq(processInstances.status, 'completed'),
    in_progress: or(
      inArray(processInstances.status, ['running', 'created']),
      and(paused, eq(processInstances.pauseReason, 'waiting_for_timer')),
    )!,
    waiting_for_human: and(
      paused,
      inArray(processInstances.pauseReason, [...WAITING_FOR_HUMAN_PAUSE_REASONS]),
    )!,
    cancelled: and(failed, eq(processInstances.error, 'Cancelled by user'))!,
    error: or(
      and(
        paused,
        or(
          isNull(processInstances.pauseReason),
          and(
            notInArray(processInstances.pauseReason, [...WAITING_FOR_HUMAN_PAUSE_REASONS]),
            ne(processInstances.pauseReason, 'waiting_for_timer'),
          ),
        ),
      ),
      and(
        failed,
        or(isNull(processInstances.error), ne(processInstances.error, 'Cancelled by user')),
      ),
    )!,
  };
}

/**
 * Postgres-backed ProcessInstanceRepository (ADR-0001, PLAN §1.2
 * process_instances + step_executions + agent_events).
 *
 * The central table: every other tenant-scoped run-context table FKs into
 * `process_instances.id`. This repo also owns the two sub-tables that
 * mirror the Firestore sub-collections (step_executions, agent_events).
 *
 * `id` is text caller-supplied so cutover preserves Firestore document ids
 * verbatim. The repo derives `workspace` from `instance.namespace` — the
 * ProcessInstance Zod schema is the only place a workspace is bound to a
 * run.
 *
 * Soft-mutable lifecycle: status transitions created → running → paused |
 * completed | failed plus in-place updates to `variables` (the accumulator).
 * The `set_updated_at` trigger on `process_instances` maintains `updated_at`
 * on every UPDATE so the Firestore-style "updated when?" semantics are
 * preserved without per-mutation bookkeeping.
 *
 * Soft-delete (`deleted_at`) + archive (`archived_at`) are timestamp
 * columns; the Zod schema exposes them as booleans (`deleted`, `archived`)
 * for parity with the Firestore representation. The hot-list partial
 * indexes exclude both — `WHERE deleted_at IS NULL AND archived_at IS NULL`
 * — so the workspace inbox + per-definition feed stay narrow.
 *
 * `addAgentEvent` / `getAgentEvents` are present here to keep the agent-
 * events table colocated with the parent (one FK declaration, one
 * migration). They are not on the ProcessInstanceRepository interface;
 * PostgresAgentEventLog (platform-infra) delegates to these methods.
 *
 * Validation parses on every read AND every write (ADR-0001 Implementation
 * pattern 2).
 */
export class PostgresProcessInstanceRepository
  implements ProcessInstanceRepository
{
  constructor(private readonly db: Database) {}

  async create(instance: ProcessInstance): Promise<ProcessInstance> {
    const parsed = ProcessInstanceSchema.parse(instance);
    if (typeof parsed.namespace !== 'string') {
      throw new Error(
        'PostgresProcessInstanceRepository.create: ProcessInstance.namespace ' +
          `is required (id=${parsed.id}).`,
      );
    }
    const [row] = await this.db
      .insert(processInstances)
      .values({
        id: parsed.id,
        workspace: parsed.namespace,
        definitionName: parsed.definitionName,
        definitionVersion: parsed.definitionVersion,
        status: parsed.status,
        currentStepId: parsed.currentStepId,
        variables: parsed.variables,
        triggerType: parsed.triggerType,
        triggerPayload: parsed.triggerPayload,
        triggerContext: parsed.triggerContext ?? null,
        pauseReason: parsed.pauseReason,
        error: parsed.error,
        assignedRoles: parsed.assignedRoles,
        previousRun: parsed.previousRun ?? null,
        previousRunSourceId: parsed.previousRunSourceId ?? null,
        totalCostUsd:
          parsed.totalCostUsd !== undefined ? String(parsed.totalCostUsd) : null,
        createdBy: parsed.createdBy,
        dryRun: parsed.dryRun === true,
        archivedAt: parsed.archived === true ? new Date() : null,
        deletedAt: parsed.deleted === true ? new Date() : null,
        createdAt: new Date(parsed.createdAt),
        updatedAt: new Date(parsed.updatedAt),
      })
      .returning();
    return toInstance(row);
  }

  async getById(instanceId: string): Promise<ProcessInstance | null> {
    const rows = await this.db
      .select()
      .from(processInstances)
      .where(eq(processInstances.id, instanceId))
      .limit(1);
    const row = rows[0];
    return row ? toInstance(row) : null;
  }

  async getNamespaceById(instanceId: string): Promise<string | null> {
    const rows = await this.db
      .select({ workspace: processInstances.workspace })
      .from(processInstances)
      .where(eq(processInstances.id, instanceId))
      .limit(1);
    return rows[0]?.workspace ?? null;
  }

  async getByIdInNamespaces(
    instanceId: string,
    allowed: readonly string[],
  ): Promise<ProcessInstance | null> {
    if (allowed.length === 0) return null;
    const rows = await this.db
      .select()
      .from(processInstances)
      .where(
        and(
          eq(processInstances.id, instanceId),
          inArray(processInstances.workspace, [...allowed]),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? toInstance(row) : null;
  }

  async listAll(options: ListInstancesOptions): Promise<ProcessInstance[]> {
    const conditions = [isNull(processInstances.deletedAt)];
    if (options.definitionName !== undefined) {
      conditions.push(eq(processInstances.definitionName, options.definitionName));
    }
    if (options.status !== undefined) {
      conditions.push(eq(processInstances.status, options.status));
    }
    if (options.namespace !== undefined) {
      conditions.push(eq(processInstances.workspace, options.namespace));
    }
    if (options.dryRun !== undefined) {
      conditions.push(eq(processInstances.dryRun, options.dryRun));
    }
    const rows = await this.db
      .select()
      .from(processInstances)
      .where(and(...conditions))
      .orderBy(desc(processInstances.createdAt))
      .limit(options.limit ?? 20);
    return rows.map((r) => toInstance(r));
  }

  async listInNamespaces(
    allowed: readonly string[],
    options: ListInstancesOptions,
  ): Promise<ProcessInstance[]> {
    if (allowed.length === 0) return [];
    const conditions = [
      isNull(processInstances.deletedAt),
      inArray(processInstances.workspace, [...allowed]),
    ];
    if (options.definitionName !== undefined) {
      conditions.push(eq(processInstances.definitionName, options.definitionName));
    }
    if (options.status !== undefined) {
      conditions.push(eq(processInstances.status, options.status));
    }
    if (options.namespace !== undefined) {
      conditions.push(eq(processInstances.workspace, options.namespace));
    }
    if (options.dryRun !== undefined) {
      conditions.push(eq(processInstances.dryRun, options.dryRun));
    }
    const rows = await this.db
      .select()
      .from(processInstances)
      .where(and(...conditions))
      .orderBy(desc(processInstances.createdAt))
      .limit(options.limit ?? 20);
    return rows.map((r) => toInstance(r));
  }

  async listPage(options: ListInstancesPageOptions): Promise<ListInstancesPage> {
    return this.listPageImpl(options, undefined);
  }

  async listPageInNamespaces(
    allowed: readonly string[],
    options: ListInstancesPageOptions,
  ): Promise<ListInstancesPage> {
    if (allowed.length === 0) return { items: [] };
    return this.listPageImpl(options, [...allowed]);
  }

  private async listPageImpl(
    options: ListInstancesPageOptions,
    allowed: readonly string[] | undefined,
  ): Promise<ListInstancesPage> {
    const conditions = [...this.pageBaseConditions(options, allowed)];
    if (options.displayStatus !== undefined) {
      conditions.push(displayStatusConditions()[options.displayStatus]);
    }
    const sort = options.sort ?? 'createdAt';
    const direction = options.direction ?? 'desc';
    if (options.cursor !== undefined) {
      const after = decodeProcessInstanceCursor(options.cursor);
      if (after !== null && after.sort === sort && after.direction === direction) {
        const tieBreaker = or(
          lt(processInstances.createdAt, new Date(after.createdAt)),
          and(
            eq(processInstances.createdAt, new Date(after.createdAt)),
            sql`${processInstances.id} < ${after.id}`,
          ),
        )!;
        if (sort === 'createdAt') {
          conditions.push(
            direction === 'asc'
              ? or(
                gt(processInstances.createdAt, new Date(after.createdAt)),
                and(
                  eq(processInstances.createdAt, new Date(after.createdAt)),
                  sql`${processInstances.id} < ${after.id}`,
                ),
              )!
              : tieBreaker,
          );
        } else if (after.totalCostUsd === null || after.totalCostUsd === undefined) {
          conditions.push(and(isNull(processInstances.totalCostUsd), tieBreaker)!);
        } else {
          const cursorCost = String(after.totalCostUsd);
          conditions.push(
            or(
              direction === 'asc'
                ? gt(processInstances.totalCostUsd, cursorCost)
                : lt(processInstances.totalCostUsd, cursorCost),
              and(eq(processInstances.totalCostUsd, cursorCost), tieBreaker),
              isNull(processInstances.totalCostUsd),
            )!,
          );
        }
      }
    }
    const rows = await this.db
      .select()
      .from(processInstances)
      .where(and(...conditions))
      .orderBy(
        ...(sort === 'cost'
          ? [
            direction === 'asc'
              ? sql`${processInstances.totalCostUsd} ASC NULLS LAST`
              : sql`${processInstances.totalCostUsd} DESC NULLS LAST`,
            desc(processInstances.createdAt),
            desc(processInstances.id),
          ]
          : [
            direction === 'asc' ? asc(processInstances.createdAt) : desc(processInstances.createdAt),
            desc(processInstances.id),
          ]),
      )
      .limit(options.limit + 1);
    const hasMore = rows.length > options.limit;
    const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
    const items = pageRows.map((r) => toInstance(r));
    const last = items[items.length - 1];
    if (hasMore && last !== undefined) {
      return {
        items,
        nextCursor: encodeProcessInstanceCursor({
          sort,
          direction,
          createdAt: last.createdAt,
          id: last.id,
          totalCostUsd: last.totalCostUsd ?? null,
        }),
      };
    }
    return { items };
  }

  async countByDisplayStatus(
    options: Pick<ListInstancesPageOptions, 'namespace' | 'definitionName' | 'dryRun' | 'archived'>,
  ): Promise<WorkflowDisplayStatusCounts> {
    return this.countByDisplayStatusImpl(options, undefined);
  }

  async countByDisplayStatusInNamespaces(
    allowed: readonly string[],
    options: Pick<ListInstancesPageOptions, 'namespace' | 'definitionName' | 'dryRun' | 'archived'>,
  ): Promise<WorkflowDisplayStatusCounts> {
    if (allowed.length === 0) {
      return { in_progress: 0, waiting_for_human: 0, error: 0, cancelled: 0, completed: 0 };
    }
    return this.countByDisplayStatusImpl(options, [...allowed]);
  }

  private async countByDisplayStatusImpl(
    options: Pick<ListInstancesPageOptions, 'namespace' | 'definitionName' | 'dryRun' | 'archived'>,
    allowed: readonly string[] | undefined,
  ): Promise<WorkflowDisplayStatusCounts> {
    const conditions = this.pageBaseConditions(options, allowed);
    const buckets = displayStatusConditions();
    const [row] = await this.db
      .select({
        in_progress: sql<number>`count(*) filter (where ${buckets.in_progress})`.mapWith(Number),
        waiting_for_human: sql<number>`count(*) filter (where ${buckets.waiting_for_human})`.mapWith(Number),
        error: sql<number>`count(*) filter (where ${buckets.error})`.mapWith(Number),
        cancelled: sql<number>`count(*) filter (where ${buckets.cancelled})`.mapWith(Number),
        completed: sql<number>`count(*) filter (where ${buckets.completed})`.mapWith(Number),
      })
      .from(processInstances)
      .where(and(...conditions));
    return row ?? { in_progress: 0, waiting_for_human: 0, error: 0, cancelled: 0, completed: 0 };
  }

  /** Shared base filters (workspace scoping, namespace, definitionName,
   *  dryRun, archived, soft-delete) for both `listPage*` and
   *  `countByDisplayStatus*` — keeps the two in sync so a KPI card's count
   *  always matches what clicking it would filter the table to. */
  private pageBaseConditions(
    options: Pick<ListInstancesPageOptions, 'namespace' | 'definitionName' | 'dryRun' | 'archived'>,
    allowed: readonly string[] | undefined,
  ): SQL[] {
    const conditions: SQL[] = [isNull(processInstances.deletedAt)];
    if (allowed !== undefined) {
      conditions.push(inArray(processInstances.workspace, [...allowed]));
    }
    if (options.namespace !== undefined) {
      conditions.push(eq(processInstances.workspace, options.namespace));
    }
    if (options.definitionName !== undefined) {
      conditions.push(eq(processInstances.definitionName, options.definitionName));
    }
    if (options.dryRun !== undefined) {
      conditions.push(eq(processInstances.dryRun, options.dryRun));
    }
    if (options.archived !== true) {
      conditions.push(isNull(processInstances.archivedAt));
    }
    return conditions;
  }

  async listDefinitionNames(namespace: string): Promise<RunNameEntry[]> {
    const rows = await this.db
      .select({
        id: processInstances.id,
        definitionName: processInstances.definitionName,
      })
      .from(processInstances)
      .where(
        and(
          eq(processInstances.workspace, namespace),
          isNull(processInstances.deletedAt),
        ),
      );
    return rows.map((r) => RunNameEntrySchema.parse(r));
  }

  async getByStatusAll(status: InstanceStatus): Promise<ProcessInstance[]> {
    const rows = await this.db
      .select()
      .from(processInstances)
      .where(eq(processInstances.status, status))
      .orderBy(desc(processInstances.createdAt));
    return rows.map((r) => toInstance(r));
  }

  async getByStatusInNamespaces(
    status: InstanceStatus,
    allowed: readonly string[],
  ): Promise<ProcessInstance[]> {
    if (allowed.length === 0) return [];
    const rows = await this.db
      .select()
      .from(processInstances)
      .where(
        and(
          eq(processInstances.status, status),
          inArray(processInstances.workspace, [...allowed]),
        ),
      )
      .orderBy(desc(processInstances.createdAt));
    return rows.map((r) => toInstance(r));
  }

  async update(
    instanceId: string,
    updates: Partial<ProcessInstance>,
  ): Promise<void> {
    const set: Record<string, unknown> = {};
    if (updates.status !== undefined) set.status = updates.status;
    if (updates.currentStepId !== undefined) set.currentStepId = updates.currentStepId;
    if (updates.variables !== undefined) set.variables = updates.variables;
    if (updates.triggerPayload !== undefined) set.triggerPayload = updates.triggerPayload;
    if (updates.pauseReason !== undefined) set.pauseReason = updates.pauseReason;
    if (updates.error !== undefined) set.error = updates.error;
    if (updates.assignedRoles !== undefined) set.assignedRoles = updates.assignedRoles;
    if (updates.previousRun !== undefined) set.previousRun = updates.previousRun;
    if (updates.previousRunSourceId !== undefined) {
      set.previousRunSourceId = updates.previousRunSourceId;
    }
    if (updates.totalCostUsd !== undefined) {
      set.totalCostUsd = String(updates.totalCostUsd);
    }
    if (updates.archived !== undefined) {
      set.archivedAt = updates.archived ? new Date() : null;
    }
    if (updates.deleted !== undefined) {
      set.deletedAt = updates.deleted ? new Date() : null;
    }
    if (Object.keys(set).length === 0) return;
    await this.db
      .update(processInstances)
      .set(set)
      .where(eq(processInstances.id, instanceId));
  }

  async getByDefinition(
    name: string,
    version: string,
  ): Promise<ProcessInstance[]> {
    const rows = await this.db
      .select()
      .from(processInstances)
      .where(
        and(
          eq(processInstances.definitionName, name),
          eq(processInstances.definitionVersion, version),
        ),
      );
    return rows.map((r) => toInstance(r));
  }

  async getLastCompletedByDefinitionName(
    name: string,
  ): Promise<ProcessInstance | null> {
    // Mirrors the Firestore query shape: filter on `deleted_at IS NULL`
    // (the Postgres analogue of `deleted === false`) so tombstoned runs
    // never shadow a valid predecessor.
    const rows = await this.db
      .select()
      .from(processInstances)
      .where(
        and(
          eq(processInstances.definitionName, name),
          eq(processInstances.status, 'completed'),
          isNull(processInstances.deletedAt),
        ),
      )
      .orderBy(desc(processInstances.updatedAt))
      .limit(1);
    const row = rows[0];
    return row ? toInstance(row) : null;
  }

  async addStepExecution(
    instanceId: string,
    execution: StepExecution,
  ): Promise<StepExecution> {
    const parsed = StepExecutionSchema.parse(execution);
    const [row] = await this.db
      .insert(stepExecutions)
      .values({
        id: parsed.id,
        processInstanceId: instanceId,
        stepId: parsed.stepId,
        status: parsed.status,
        iterationNumber: parsed.iterationNumber,
        input: parsed.input,
        output: parsed.output,
        verdict: parsed.verdict,
        gateResult: parsed.gateResult,
        error: parsed.error,
        reviewVerdicts: parsed.reviewVerdicts ?? null,
        agentOutput: parsed.agentOutput ?? null,
        executedBy: parsed.executedBy,
        startedAt: new Date(parsed.startedAt),
        completedAt: parsed.completedAt ? new Date(parsed.completedAt) : null,
      })
      .returning();
    return toStepExecution(row, instanceId);
  }

  async getStepExecutions(instanceId: string): Promise<StepExecution[]> {
    const rows = await this.db
      .select()
      .from(stepExecutions)
      .where(eq(stepExecutions.processInstanceId, instanceId))
      .orderBy(asc(stepExecutions.startedAt));
    return rows.map((r) =>
      toStepExecution(r, instanceId),
    );
  }

  async getLatestStepExecution(
    instanceId: string,
    stepId: string,
  ): Promise<StepExecution | null> {
    const rows = await this.db
      .select()
      .from(stepExecutions)
      .where(
        and(
          eq(stepExecutions.processInstanceId, instanceId),
          eq(stepExecutions.stepId, stepId),
        ),
      )
      .orderBy(desc(stepExecutions.startedAt))
      .limit(1);
    const row = rows[0];
    return row ? toStepExecution(row, instanceId) : null;
  }

  async updateStepExecution(
    instanceId: string,
    executionId: string,
    updates: Partial<StepExecution>,
  ): Promise<void> {
    const set: Record<string, unknown> = {};
    if (updates.status !== undefined) set.status = updates.status;
    if (updates.input !== undefined) set.input = updates.input;
    if (updates.output !== undefined) set.output = updates.output;
    if (updates.verdict !== undefined) set.verdict = updates.verdict;
    if (updates.gateResult !== undefined) set.gateResult = updates.gateResult;
    if (updates.error !== undefined) set.error = updates.error;
    if (updates.reviewVerdicts !== undefined) {
      set.reviewVerdicts = updates.reviewVerdicts;
    }
    if (updates.agentOutput !== undefined) set.agentOutput = updates.agentOutput;
    if (updates.executedBy !== undefined) set.executedBy = updates.executedBy;
    if (updates.iterationNumber !== undefined) {
      set.iterationNumber = updates.iterationNumber;
    }
    if (updates.startedAt !== undefined) set.startedAt = new Date(updates.startedAt);
    if (updates.completedAt !== undefined) {
      set.completedAt = updates.completedAt ? new Date(updates.completedAt) : null;
    }
    if (Object.keys(set).length === 0) return;
    await this.db
      .update(stepExecutions)
      .set(set)
      .where(
        and(
          eq(stepExecutions.processInstanceId, instanceId),
          eq(stepExecutions.id, executionId),
        ),
      );
  }

  async getIdsByDefinitionName(namespace: string, name: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: processInstances.id })
      .from(processInstances)
      .where(
        and(
          eq(processInstances.workspace, namespace),
          eq(processInstances.definitionName, name),
        ),
      );
    return rows.map((r) => r.id);
  }

  async setDeletedByDefinitionName(
    namespace: string,
    name: string,
    deleted: boolean,
  ): Promise<void> {
    await this.db
      .update(processInstances)
      .set({ deletedAt: deleted ? new Date() : null })
      .where(
        and(
          eq(processInstances.workspace, namespace),
          eq(processInstances.definitionName, name),
        ),
      );
  }

  async summarizeRunsByWorkflow(
    namespace: string,
    name: string,
    includeCompleted: boolean,
  ): Promise<WorkflowRunSummaryResult> {
    const base = and(
      eq(processInstances.workspace, namespace),
      eq(processInstances.definitionName, name),
      isNull(processInstances.deletedAt),
      isNull(processInstances.archivedAt),
    );

    const [activeRow] = await this.db
      .select({ value: count() })
      .from(processInstances)
      .where(and(base, inArray(processInstances.status, [...ACTIVE_STATUSES])));
    const active = Number(activeRow?.value ?? 0);

    const totalWhere = includeCompleted
      ? base
      : and(base, inArray(processInstances.status, [...NON_TERMINAL_STATUSES]));
    const [totalRow] = await this.db
      .select({ value: count() })
      .from(processInstances)
      .where(totalWhere);
    const total = Number(totalRow?.value ?? 0);

    const latestRows = await this.db
      .select()
      .from(processInstances)
      .where(totalWhere)
      .orderBy(desc(processInstances.createdAt))
      .limit(3);
    const latest = latestRows.map((r) =>
      toInstance(r),
    );

    return { total, active, latest };
  }

  /**
   * Append a single agent event under (instanceId, stepId). Caller mints
   * `id` + `sequence` (PostgresAgentEventLog uses `crypto.randomUUID()` +
   * the next free position). Not on the ProcessInstanceRepository
   * interface — see class-level docs.
   */
  async addAgentEvent(instanceId: string, event: AgentEvent): Promise<AgentEvent> {
    const parsed = AgentEventSchema.parse(event);
    const [row] = await this.db
      .insert(agentEvents)
      .values({
        id: parsed.id,
        processInstanceId: instanceId,
        stepId: parsed.stepId,
        type: parsed.type,
        payload: parsed.payload as Record<string, unknown> | null,
        sequence: parsed.sequence,
        timestamp: new Date(parsed.timestamp),
      })
      .returning();
    return AgentEventSchema.parse(toAgentEvent(row, instanceId));
  }

  /**
   * Read agent events for an instance, optionally narrowed to a step.
   * Ordered by `sequence` to match the in-memory cache.
   */
  async getAgentEvents(
    instanceId: string,
    stepId?: string,
  ): Promise<AgentEvent[]> {
    const conditions = [eq(agentEvents.processInstanceId, instanceId)];
    if (stepId !== undefined) {
      conditions.push(eq(agentEvents.stepId, stepId));
    }
    const rows = await this.db
      .select()
      .from(agentEvents)
      .where(and(...conditions))
      .orderBy(asc(agentEvents.sequence));
    return rows.map((r) => AgentEventSchema.parse(toAgentEvent(r, instanceId)));
  }
}

function toInstance(row: typeof processInstances.$inferSelect): ProcessInstance {
  return parseRow(ProcessInstanceSchema, {
    id: row.id,
    namespace: row.workspace,
    definitionName: row.definitionName,
    definitionVersion: row.definitionVersion,
    status: row.status,
    currentStepId: row.currentStepId,
    variables: (row.variables ?? {}) as Record<string, unknown>,
    triggerType: row.triggerType,
    triggerPayload: (row.triggerPayload ?? {}) as Record<string, unknown>,
    // Left `undefined` (not `{}`) when the column is null so a manual start and
    // a pre-ADR-0012 run both read as "this firing had no transport metadata".
    ...(row.triggerContext === null || row.triggerContext === undefined
      ? {}
      : { triggerContext: row.triggerContext as Record<string, unknown> }),
    pauseReason: row.pauseReason,
    error: row.error,
    assignedRoles: row.assignedRoles ?? [],
    deleted: row.deletedAt !== null,
    archived: row.archivedAt !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdBy: row.createdBy ?? '',
    previousRun:
      row.previousRun !== null
        ? (row.previousRun as Record<string, unknown>)
        : undefined,
    previousRunSourceId: row.previousRunSourceId ?? undefined,
    totalCostUsd: row.totalCostUsd !== null ? Number(row.totalCostUsd) : undefined,
    dryRun: row.dryRun === true,
  });
}

function toStepExecution(
  row: typeof stepExecutions.$inferSelect,
  instanceId: string,
): StepExecution {
  return parseRow(StepExecutionSchema, {
    id: row.id,
    instanceId,
    stepId: row.stepId,
    status: row.status,
    input: (row.input ?? {}) as Record<string, unknown>,
    output: row.output as Record<string, unknown> | null,
    verdict: row.verdict,
    gateResult: row.gateResult as StepExecution['gateResult'],
    error: row.error,
    executedBy: row.executedBy ?? '',
    startedAt: row.startedAt
      ? row.startedAt.toISOString()
      : new Date(0).toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    iterationNumber: row.iterationNumber,
    reviewVerdicts: row.reviewVerdicts ?? undefined,
    agentOutput: row.agentOutput ?? undefined,
  });
}

function toAgentEvent(
  row: typeof agentEvents.$inferSelect,
  instanceId: string,
): AgentEvent {
  return {
    id: row.id,
    processInstanceId: instanceId,
    stepId: row.stepId,
    type: row.type,
    payload: row.payload,
    sequence: Number(row.sequence),
    timestamp: row.timestamp.toISOString(),
  };
}
