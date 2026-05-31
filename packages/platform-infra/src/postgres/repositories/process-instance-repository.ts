import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  ProcessInstanceSchema,
  StepExecutionSchema,
  AgentEventSchema,
  parseRow,
  type ProcessInstance,
  type ProcessInstanceRepository,
  type InstanceStatus,
  type StepExecution,
  type AgentEvent,
  type ListInstancesOptions,
  type WorkflowRunSummaryResult,
} from '@mediforce/platform-core';
import type { Database } from '../client';
import {
  processInstances,
  stepExecutions,
  agentEvents,
} from '../schema/process-instance';

const ACTIVE_STATUSES: readonly InstanceStatus[] = ['running', 'created', 'paused'];
const NON_TERMINAL_STATUSES: readonly InstanceStatus[] = ['running', 'created', 'paused'];

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
        pauseReason: parsed.pauseReason,
        error: parsed.error,
        assignedRoles: parsed.assignedRoles,
        previousRun: parsed.previousRun ?? null,
        previousRunSourceId: parsed.previousRunSourceId ?? null,
        totalCostUsd:
          parsed.totalCostUsd !== undefined ? String(parsed.totalCostUsd) : null,
        createdBy: parsed.createdBy,
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
    const rows = await this.db
      .select()
      .from(processInstances)
      .where(and(...conditions))
      .orderBy(desc(processInstances.createdAt))
      .limit(options.limit ?? 20);
    return rows.map((r) => toInstance(r));
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

  async getIdsByDefinitionName(name: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: processInstances.id })
      .from(processInstances)
      .where(eq(processInstances.definitionName, name));
    return rows.map((r) => r.id);
  }

  async setDeletedByDefinitionName(
    name: string,
    deleted: boolean,
  ): Promise<void> {
    await this.db
      .update(processInstances)
      .set({ deletedAt: deleted ? new Date() : null })
      .where(eq(processInstances.definitionName, name));
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

