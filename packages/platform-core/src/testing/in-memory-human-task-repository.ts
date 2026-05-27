import { HumanTaskSchema, type HumanTask } from '../schemas/human-task.js';
import type { HumanTaskRepository } from '../interfaces/human-task-repository.js';
import type { ProcessInstanceRepository } from '../interfaces/process-instance-repository.js';

/**
 * In-memory implementation of HumanTaskRepository for testing.
 * Uses a plain Map for storage. Does not call external services.
 *
 * Namespace-scoped methods (`*InNamespaces`) resolve the parent run's
 * namespace via the injected `ProcessInstanceRepository`. If a test
 * doesn't exercise those paths, the constructor dep may be omitted —
 * those methods will throw a descriptive error if called without one.
 */
export class InMemoryHumanTaskRepository implements HumanTaskRepository {
  private readonly tasks = new Map<string, HumanTask>();

  constructor(private readonly parents?: ProcessInstanceRepository) {}

  async create(task: HumanTask): Promise<HumanTask> {
    // Parse on write — mirrors the Firestore + Postgres backends (ADR-0001
    // Implementation pattern 2).
    const parsed = HumanTaskSchema.parse(task);
    this.tasks.set(parsed.id, { ...parsed });
    return { ...parsed };
  }

  async getById(taskId: string): Promise<HumanTask | null> {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : null;
  }

  async getByIdInNamespaces(
    taskId: string,
    allowed: readonly string[],
  ): Promise<HumanTask | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    const parent = await this.requireParents().getById(task.processInstanceId);
    if (!parent || typeof parent.namespace !== 'string') return null;
    return allowed.includes(parent.namespace) ? { ...task } : null;
  }

  async getByRoleAll(role: string): Promise<HumanTask[]> {
    // Mirror the Postgres partial index: tombstoned tasks are excluded from
    // the role queue. Callers narrow by status via ACTIONABLE_STATUSES if
    // they want the actionable subset.
    return [...this.tasks.values()].filter(
      (t) => t.assignedRole === role && t.deleted !== true,
    );
  }

  async getByRoleInNamespaces(
    role: string,
    allowed: readonly string[],
  ): Promise<HumanTask[]> {
    const tasks = await this.getByRoleAll(role);
    return this.filterByParentNamespace(tasks, allowed);
  }

  async getByInstanceId(instanceId: string): Promise<HumanTask[]> {
    return [...this.tasks.values()].filter(
      (t) => t.processInstanceId === instanceId,
    );
  }

  async getByInstanceIdInNamespaces(
    instanceId: string,
    allowed: readonly string[],
  ): Promise<HumanTask[]> {
    const parent = await this.requireParents().getById(instanceId);
    if (!parent || typeof parent.namespace !== 'string') return [];
    if (!allowed.includes(parent.namespace)) return [];
    return this.getByInstanceId(instanceId);
  }

  async claim(taskId: string, userId: string): Promise<HumanTask> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`HumanTask not found: ${taskId}`);
    const now = new Date().toISOString();
    const updated: HumanTask = {
      ...task,
      assignedUserId: userId,
      status: 'claimed',
      updatedAt: now,
    };
    this.tasks.set(taskId, updated);
    return { ...updated };
  }

  async complete(taskId: string, completionData: Record<string, unknown>): Promise<HumanTask> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`HumanTask not found: ${taskId}`);
    const now = new Date().toISOString();
    const updated: HumanTask = {
      ...task,
      status: 'completed',
      completionData,
      completedAt: now,
      updatedAt: now,
    };
    this.tasks.set(taskId, updated);
    return { ...updated };
  }

  async cancel(taskId: string): Promise<HumanTask> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`HumanTask not found: ${taskId}`);
    const now = new Date().toISOString();
    const updated: HumanTask = {
      ...task,
      status: 'cancelled',
      updatedAt: now,
    };
    this.tasks.set(taskId, updated);
    return { ...updated };
  }

  async setDeletedByInstanceIds(
    instanceIds: string[],
    deleted: boolean,
  ): Promise<void> {
    if (instanceIds.length === 0) return;
    const idSet = new Set(instanceIds);
    for (const [id, task] of this.tasks.entries()) {
      if (idSet.has(task.processInstanceId)) {
        const updated: HumanTask = { ...task, deleted };
        this.tasks.set(id, updated);
      }
    }
  }

  private requireParents(): ProcessInstanceRepository {
    if (this.parents === undefined) {
      throw new Error(
        'InMemoryHumanTaskRepository: ProcessInstanceRepository required for namespace-scoped methods',
      );
    }
    return this.parents;
  }

  private async filterByParentNamespace<T extends { processInstanceId: string }>(
    rows: T[],
    allowed: readonly string[],
  ): Promise<T[]> {
    if (rows.length === 0) return [];
    const parents = this.requireParents();
    const instanceIds = [...new Set(rows.map((r) => r.processInstanceId))];
    const namespaceById = new Map<string, string | undefined>();
    await Promise.all(
      instanceIds.map(async (id) => {
        const parent = await parents.getById(id);
        namespaceById.set(id, parent?.namespace);
      }),
    );
    return rows.filter((r) => {
      const ns = namespaceById.get(r.processInstanceId);
      return typeof ns === 'string' && allowed.includes(ns);
    });
  }

  /** Test helper: clear all stored data */
  clear(): void {
    this.tasks.clear();
  }

  /** Test helper: return all tasks */
  getAll(): HumanTask[] {
    return [...this.tasks.values()];
  }
}
