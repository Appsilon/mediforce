import type { HumanTask } from '../schemas/human-task';

/**
 * Storage-layer authorization (ADR-0004): tasks have no namespace field of
 * their own — workspace membership is reached via the parent `ProcessInstance`.
 * Implementations resolve parent namespaces internally (via an injected
 * `ProcessInstanceRepository`) so the wrapper layer stays a thin router.
 */
export interface HumanTaskRepository {
  create(task: HumanTask): Promise<HumanTask>;

  getById(taskId: string): Promise<HumanTask | null>;
  /** Returns the task only if its parent run's namespace is in `allowed`. */
  getByIdInNamespaces(taskId: string, allowed: readonly string[]): Promise<HumanTask | null>;

  getByRoleAll(role: string): Promise<HumanTask[]>; // every task with this assignedRole (all statuses — caller must filter via `ACTIONABLE_STATUSES` or explicit list if it wants the "actionable" subset)
  getByRoleInNamespaces(role: string, allowed: readonly string[]): Promise<HumanTask[]>;

  getByInstanceId(instanceId: string): Promise<HumanTask[]>;
  getByInstanceIdInNamespaces(instanceId: string, allowed: readonly string[]): Promise<HumanTask[]>;

  /**
   * Bulk variant: every task whose parent is in `instanceIds`. Firestore
   * impl chunks by the `in` operator's 30-value limit and fans the
   * chunks out in parallel; in-memory impl filters in one pass. Callers
   * that would otherwise loop `getByInstanceId` per parent (e.g.
   * monitoring summary aggregation) collapse to a single repo call.
   */
  getByInstanceIdsAll(instanceIds: readonly string[]): Promise<HumanTask[]>;
  getByInstanceIdsInNamespaces(instanceIds: readonly string[], allowed: readonly string[]): Promise<HumanTask[]>;

  /** Every task in the store, irrespective of role or instance. */
  listAll(): Promise<HumanTask[]>;
  /** Every task whose parent run's namespace appears in `allowed`. */
  listInNamespaces(allowed: readonly string[]): Promise<HumanTask[]>;

  claim(taskId: string, userId: string): Promise<HumanTask>; // sets assignedUserId + status: 'claimed'
  complete(taskId: string, completionData: Record<string, unknown>): Promise<HumanTask>;
  cancel(taskId: string): Promise<HumanTask>;
  setDeletedByInstanceIds(instanceIds: string[], deleted: boolean): Promise<void>;
}
