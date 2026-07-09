import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import {
  HumanTaskSchema,
  parseRow,
  type HumanTask,
  type HumanTaskRepository,
  type ProcessInstanceRepository,
} from '@mediforce/platform-core';
import type { Database } from '../client';
import { humanTasks } from '../schema/human-task';

/**
 * Postgres-backed HumanTaskRepository (ADR-0001, PLAN §1.2 human_tasks).
 *
 * Soft-mutable lifecycle: status transitions pending → claimed → completed
 * | cancelled. The `set_updated_at` trigger maintains `updated_at` on
 * every UPDATE so the Firestore-style "updated when?" semantics are
 * preserved without per-mutation bookkeeping in the repo.
 *
 * Soft-delete via `deleted_at` (NULL = active, set = tombstone). Mirrors
 * the Firestore boolean `deleted` flag — reads surface `deleted: true` on
 * tombstoned rows for parity. The role-queue partial index excludes
 * tombstones so the workflow inbox stays cheap.
 *
 * The `workspace` column is derived at insert time from the parent
 * ProcessInstance — HumanTask itself carries no namespace field, so we
 * resolve it via the injected `ProcessInstanceRepository` (mirrors the
 * Firestore impl and the agent-run repo). Reads stay simple: rows already
 * carry `workspace`, so namespace-scoped variants filter with
 * `workspace = ANY($)` — no parent lookup needed on the read path.
 *
 * Validation matches the Firestore + in-memory backends: parse on every
 * read AND every write (ADR-0001 Implementation pattern 2).
 */
export class PostgresHumanTaskRepository implements HumanTaskRepository {
  constructor(
    private readonly db: Database,
    private readonly parents: ProcessInstanceRepository,
  ) {}

  async create(task: HumanTask): Promise<HumanTask> {
    const parsed = HumanTaskSchema.parse(task);
    const parent = await this.parents.getById(parsed.processInstanceId);
    if (!parent || typeof parent.namespace !== 'string') {
      throw new Error(
        'PostgresHumanTaskRepository.create: cannot resolve workspace — ' +
          `parent ProcessInstance ${parsed.processInstanceId} missing or has no namespace.`,
      );
    }
    const [row] = await this.db
      .insert(humanTasks)
      .values({
        id: parsed.id,
        workspace: parent.namespace,
        processInstanceId: parsed.processInstanceId,
        stepId: parsed.stepId,
        assignedRole: parsed.assignedRole,
        assignedUserId: parsed.assignedUserId,
        status: parsed.status,
        deadline: parsed.deadline ? new Date(parsed.deadline) : null,
        completionData: parsed.completionData,
        completedAt: parsed.completedAt ? new Date(parsed.completedAt) : null,
        ui: parsed.ui ?? null,
        params: parsed.params ?? null,
        selection: parsed.selection ?? null,
        options: parsed.options ?? null,
        verdicts: parsed.verdicts ?? null,
        creationReason: parsed.creationReason ?? 'human_executor',
        deletedAt: parsed.deleted === true ? new Date() : null,
        createdAt: new Date(parsed.createdAt),
        updatedAt: new Date(parsed.updatedAt),
      })
      .returning();
    return toHumanTask(row);
  }

  async getById(taskId: string): Promise<HumanTask | null> {
    const rows = await this.db
      .select()
      .from(humanTasks)
      .where(eq(humanTasks.id, taskId))
      .limit(1);
    const row = rows[0];
    return row ? toHumanTask(row) : null;
  }

  async getByIdInNamespaces(
    taskId: string,
    allowed: readonly string[],
  ): Promise<HumanTask | null> {
    if (allowed.length === 0) return null;
    const rows = await this.db
      .select()
      .from(humanTasks)
      .where(
        and(
          eq(humanTasks.id, taskId),
          inArray(humanTasks.workspace, [...allowed]),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? toHumanTask(row) : null;
  }

  async getByRoleAll(role: string): Promise<HumanTask[]> {
    // Partial-index-friendly: filter `deleted_at IS NULL` to align with the
    // `human_tasks_role_queue_idx` partial index, then order by createdAt
    // ASC for queue semantics. Firestore impl returns all statuses —
    // callers narrow via ACTIONABLE_STATUSES if they want the actionable
    // subset.
    const rows = await this.db
      .select()
      .from(humanTasks)
      .where(
        and(eq(humanTasks.assignedRole, role), isNull(humanTasks.deletedAt)),
      )
      .orderBy(asc(humanTasks.createdAt));
    return rows.map((r) => toHumanTask(r));
  }

  async getByRoleInNamespaces(
    role: string,
    allowed: readonly string[],
  ): Promise<HumanTask[]> {
    if (allowed.length === 0) return [];
    const rows = await this.db
      .select()
      .from(humanTasks)
      .where(
        and(
          eq(humanTasks.assignedRole, role),
          inArray(humanTasks.workspace, [...allowed]),
          isNull(humanTasks.deletedAt),
        ),
      )
      .orderBy(asc(humanTasks.createdAt));
    return rows.map((r) => toHumanTask(r));
  }

  async getByInstanceId(instanceId: string): Promise<HumanTask[]> {
    const rows = await this.db
      .select()
      .from(humanTasks)
      .where(eq(humanTasks.processInstanceId, instanceId));
    return rows.map((r) => toHumanTask(r));
  }

  async getByInstanceIdInNamespaces(
    instanceId: string,
    allowed: readonly string[],
  ): Promise<HumanTask[]> {
    if (allowed.length === 0) return [];
    const rows = await this.db
      .select()
      .from(humanTasks)
      .where(
        and(
          eq(humanTasks.processInstanceId, instanceId),
          inArray(humanTasks.workspace, [...allowed]),
        ),
      );
    return rows.map((r) => toHumanTask(r));
  }

  async getByInstanceIdsAll(instanceIds: readonly string[]): Promise<HumanTask[]> {
    if (instanceIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(humanTasks)
      .where(inArray(humanTasks.processInstanceId, [...instanceIds]));
    return rows.map((r) => toHumanTask(r));
  }

  async getByInstanceIdsInNamespaces(
    instanceIds: readonly string[],
    allowed: readonly string[],
  ): Promise<HumanTask[]> {
    if (instanceIds.length === 0 || allowed.length === 0) return [];
    const rows = await this.db
      .select()
      .from(humanTasks)
      .where(
        and(
          inArray(humanTasks.processInstanceId, [...instanceIds]),
          inArray(humanTasks.workspace, [...allowed]),
        ),
      );
    return rows.map((r) => toHumanTask(r));
  }

  async listAll(): Promise<HumanTask[]> {
    const rows = await this.db.select().from(humanTasks);
    return rows.map((r) => toHumanTask(r));
  }

  async listInNamespaces(allowed: readonly string[]): Promise<HumanTask[]> {
    if (allowed.length === 0) return [];
    const rows = await this.db
      .select()
      .from(humanTasks)
      .where(inArray(humanTasks.workspace, [...allowed]));
    return rows.map((r) => toHumanTask(r));
  }

  async claim(taskId: string, userId: string): Promise<HumanTask> {
    // `updated_at` is maintained by the `set_updated_at` trigger.
    const [row] = await this.db
      .update(humanTasks)
      .set({ assignedUserId: userId, status: 'claimed' })
      .where(eq(humanTasks.id, taskId))
      .returning();
    if (!row) throw new Error(`HumanTask not found: ${taskId}`);
    return toHumanTask(row);
  }

  async complete(
    taskId: string,
    completionData: Record<string, unknown>,
  ): Promise<HumanTask> {
    const [row] = await this.db
      .update(humanTasks)
      .set({
        status: 'completed',
        completionData,
        completedAt: new Date(),
      })
      .where(eq(humanTasks.id, taskId))
      .returning();
    if (!row) throw new Error(`HumanTask not found: ${taskId}`);
    return toHumanTask(row);
  }

  async cancel(taskId: string): Promise<HumanTask> {
    const [row] = await this.db
      .update(humanTasks)
      .set({ status: 'cancelled' })
      .where(eq(humanTasks.id, taskId))
      .returning();
    if (!row) throw new Error(`HumanTask not found: ${taskId}`);
    return toHumanTask(row);
  }

  async setDeletedByInstanceIds(
    instanceIds: string[],
    deleted: boolean,
  ): Promise<void> {
    if (instanceIds.length === 0) return;
    await this.db
      .update(humanTasks)
      .set({ deletedAt: deleted ? new Date() : null })
      .where(inArray(humanTasks.processInstanceId, instanceIds));
  }
}

function toHumanTask(row: typeof humanTasks.$inferSelect): HumanTask {
  return parseRow(HumanTaskSchema, {
    id: row.id,
    processInstanceId: row.processInstanceId,
    stepId: row.stepId,
    assignedRole: row.assignedRole,
    assignedUserId: row.assignedUserId,
    status: row.status,
    deadline: row.deadline ? row.deadline.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    completionData: row.completionData as Record<string, unknown> | null,
    creationReason: row.creationReason,
    ui: row.ui ?? undefined,
    params: row.params ?? undefined,
    selection: row.selection ?? undefined,
    options: row.options ?? undefined,
    verdicts: row.verdicts ?? undefined,
    deleted: row.deletedAt !== null ? true : undefined,
  });
}
