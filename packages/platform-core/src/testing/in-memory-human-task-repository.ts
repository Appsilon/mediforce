import type { HumanTask } from '../schemas/human-task.js';
import type { HumanTaskRepository } from '../interfaces/human-task-repository.js';

/**
 * In-memory implementation of HumanTaskRepository for testing.
 * Uses a plain Map for storage. Does not call external services.
 * Reusable by any package that needs test doubles for human task operations.
 */
export class InMemoryHumanTaskRepository implements HumanTaskRepository {
  private readonly tasks = new Map<string, HumanTask>();

  async create(task: HumanTask): Promise<HumanTask> {
    this.tasks.set(task.id, { ...task });
    return { ...task };
  }

  async getById(taskId: string): Promise<HumanTask | null> {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : null;
  }

  async getByRole(role: string): Promise<HumanTask[]> {
    return [...this.tasks.values()].filter(
      (t) => t.assignedRole === role && (t.status === 'pending' || t.status === 'claimed'),
    );
  }

  async getByInstanceId(instanceId: string): Promise<HumanTask[]> {
    return [...this.tasks.values()].filter(
      (t) => t.processInstanceId === instanceId,
    );
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

  async setDeletedByInstanceIds(_instanceIds: string[], _deleted: boolean): Promise<void> {
    // No-op in test double
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
