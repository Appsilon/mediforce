import {
  ProcessInstanceSchema,
  StepExecutionSchema,
  getWorkflowStatus,
  encodeProcessInstanceCursor,
  decodeProcessInstanceCursor,
  type ProcessInstanceCursorPayload,
  type ProcessInstanceRepository,
  type ProcessInstance,
  type InstanceStatus,
  type StepExecution,
  type ListInstancesOptions,
  type ListInstancesPageOptions,
  type ListInstancesPage,
  type WorkflowDisplayStatusCounts,
  type WorkflowRunSummaryResult,
} from '../index';
import { RunNameEntrySchema, type RunNameEntry } from '../schemas/process-instance';

const ACTIVE_STATUSES: ReadonlySet<InstanceStatus> = new Set([
  'running',
  'created',
  'paused',
]);
const TERMINAL_STATUSES: ReadonlySet<InstanceStatus> = new Set([
  'completed',
  'failed',
]);

/**
 * In-memory implementation of ProcessInstanceRepository for testing.
 * Uses Maps for instances and step execution subcollections.
 * Reusable by any package that needs test doubles for process instance operations.
 */
export class InMemoryProcessInstanceRepository
  implements ProcessInstanceRepository
{
  private instances = new Map<string, ProcessInstance>();
  private stepExecutions = new Map<string, StepExecution[]>();

  async create(instance: ProcessInstance): Promise<ProcessInstance> {
    const parsed = ProcessInstanceSchema.parse(instance);
    this.instances.set(parsed.id, { ...parsed });
    return { ...parsed };
  }

  async getById(instanceId: string): Promise<ProcessInstance | null> {
    const instance = this.instances.get(instanceId);
    return instance ? { ...instance } : null;
  }

  async getByIdInNamespaces(
    instanceId: string,
    allowed: readonly string[],
  ): Promise<ProcessInstance | null> {
    const instance = this.instances.get(instanceId);
    if (!instance) return null;
    return allowed.includes(instance.namespace ?? '') ? { ...instance } : null;
  }

  async getNamespaceById(instanceId: string): Promise<string | null> {
    const instance = this.instances.get(instanceId);
    if (!instance) return null;
    return typeof instance.namespace === 'string' && instance.namespace.length > 0
      ? instance.namespace
      : null;
  }

  async update(
    instanceId: string,
    updates: Partial<ProcessInstance>,
  ): Promise<void> {
    const existing = this.instances.get(instanceId);
    if (!existing) {
      throw new Error(`ProcessInstance not found: ${instanceId}`);
    }
    this.instances.set(instanceId, { ...existing, ...updates });
  }

  async listAll(options: ListInstancesOptions): Promise<ProcessInstance[]> {
    return this.applyListFilters([...this.instances.values()], options);
  }

  async listInNamespaces(
    allowed: readonly string[],
    options: ListInstancesOptions,
  ): Promise<ProcessInstance[]> {
    const inScope = [...this.instances.values()].filter((i) =>
      allowed.includes(i.namespace ?? ''),
    );
    return this.applyListFilters(inScope, options);
  }

  async listPage(options: ListInstancesPageOptions): Promise<ListInstancesPage> {
    return this.listPageImpl([...this.instances.values()], options);
  }

  async listPageInNamespaces(
    allowed: readonly string[],
    options: ListInstancesPageOptions,
  ): Promise<ListInstancesPage> {
    const inScope = [...this.instances.values()].filter((i) =>
      allowed.includes(i.namespace ?? ''),
    );
    return this.listPageImpl(inScope, options);
  }

  private listPageImpl(
    rows: ProcessInstance[],
    options: ListInstancesPageOptions,
  ): ListInstancesPage {
    let results = this.applyPageBaseFilters(rows, options);
    if (options.displayStatus !== undefined) {
      results = results.filter((i) => getWorkflowStatus(i).displayStatus === options.displayStatus);
    }
    const sort = options.sort ?? 'createdAt';
    const direction = options.direction ?? 'desc';
    results.sort((left, right) => this.comparePageRows(left, right, sort, direction));
    if (options.cursor !== undefined) {
      const after = decodeProcessInstanceCursor(options.cursor);
      if (after !== null && after.sort === sort && after.direction === direction) {
        results = results.filter((instance) => this.isAfterCursor(instance, after, sort, direction));
      }
    }
    const hasMore = results.length > options.limit;
    const pageRows = hasMore ? results.slice(0, options.limit) : results;
    const last = pageRows[pageRows.length - 1];
    if (hasMore && last !== undefined) {
      return {
        items: pageRows.map((i) => ({ ...i })),
        nextCursor: encodeProcessInstanceCursor({
          sort,
          direction,
          createdAt: last.createdAt,
          id: last.id,
          totalCostUsd: last.totalCostUsd ?? null,
        }),
      };
    }
    return { items: pageRows.map((i) => ({ ...i })) };
  }

  private comparePageRows(
    left: ProcessInstance,
    right: ProcessInstance,
    sort: 'createdAt' | 'cost',
    direction: 'asc' | 'desc',
  ): number {
    if (sort === 'cost') {
      const leftCost = left.totalCostUsd;
      const rightCost = right.totalCostUsd;
      if (leftCost === undefined && rightCost !== undefined) return 1;
      if (leftCost !== undefined && rightCost === undefined) return -1;
      if (leftCost !== undefined && rightCost !== undefined && leftCost !== rightCost) {
        return direction === 'asc' ? leftCost - rightCost : rightCost - leftCost;
      }
    } else if (left.createdAt !== right.createdAt) {
      return direction === 'asc'
        ? left.createdAt.localeCompare(right.createdAt)
        : right.createdAt.localeCompare(left.createdAt);
    }
    if (left.createdAt !== right.createdAt) return right.createdAt.localeCompare(left.createdAt);
    return right.id.localeCompare(left.id);
  }

  private isAfterCursor(
    instance: ProcessInstance,
    cursor: ProcessInstanceCursorPayload,
    sort: 'createdAt' | 'cost',
    direction: 'asc' | 'desc',
  ): boolean {
    const isLaterTieBreaker =
      instance.createdAt < cursor.createdAt ||
      (instance.createdAt === cursor.createdAt && instance.id < cursor.id);
    if (sort === 'createdAt') {
      return direction === 'asc'
        ? instance.createdAt > cursor.createdAt || (instance.createdAt === cursor.createdAt && instance.id < cursor.id)
        : isLaterTieBreaker;
    }
    const cursorCost = cursor.totalCostUsd;
    const instanceCost = instance.totalCostUsd;
    if (cursorCost === null || cursorCost === undefined) {
      return instanceCost === undefined && isLaterTieBreaker;
    }
    if (instanceCost === undefined) return true;
    if (instanceCost === cursorCost) return isLaterTieBreaker;
    return direction === 'asc' ? instanceCost > cursorCost : instanceCost < cursorCost;
  }

  async countByDisplayStatus(
    options: Pick<ListInstancesPageOptions, 'namespace' | 'definitionName' | 'dryRun' | 'archived'>,
  ): Promise<WorkflowDisplayStatusCounts> {
    return this.countByDisplayStatusImpl(this.applyPageBaseFilters([...this.instances.values()], options));
  }

  async countByDisplayStatusInNamespaces(
    allowed: readonly string[],
    options: Pick<ListInstancesPageOptions, 'namespace' | 'definitionName' | 'dryRun' | 'archived'>,
  ): Promise<WorkflowDisplayStatusCounts> {
    const inScope = [...this.instances.values()].filter((i) => allowed.includes(i.namespace ?? ''));
    return this.countByDisplayStatusImpl(this.applyPageBaseFilters(inScope, options));
  }

  private countByDisplayStatusImpl(rows: ProcessInstance[]): WorkflowDisplayStatusCounts {
    const counts: WorkflowDisplayStatusCounts = {
      in_progress: 0,
      waiting_for_human: 0,
      error: 0,
      cancelled: 0,
      completed: 0,
    };
    for (const instance of rows) {
      counts[getWorkflowStatus(instance).displayStatus]++;
    }
    return counts;
  }

  private applyPageBaseFilters(
    rows: ProcessInstance[],
    options: Pick<ListInstancesPageOptions, 'namespace' | 'definitionName' | 'dryRun' | 'archived'>,
  ): ProcessInstance[] {
    let results = rows.filter((i) => i.deleted !== true);
    if (options.namespace !== undefined) {
      results = results.filter((i) => i.namespace === options.namespace);
    }
    if (options.definitionName !== undefined) {
      results = results.filter((i) => i.definitionName === options.definitionName);
    }
    if (options.dryRun !== undefined) {
      results = results.filter((i) => (i.dryRun === true) === options.dryRun);
    }
    if (options.archived !== true) {
      results = results.filter((i) => i.archived !== true);
    }
    return results;
  }

  async listDefinitionNames(namespace: string): Promise<RunNameEntry[]> {
    return [...this.instances.values()]
      .filter((i) => i.deleted !== true && i.namespace === namespace)
      .map((i) => RunNameEntrySchema.parse({ id: i.id, definitionName: i.definitionName }));
  }

  private applyListFilters(
    rows: ProcessInstance[],
    options: ListInstancesOptions,
  ): ProcessInstance[] {
    let results = rows.filter((i) => i.deleted !== true);
    if (options.namespace !== undefined) {
      results = results.filter((i) => i.namespace === options.namespace);
    }
    if (options.definitionName !== undefined) {
      results = results.filter((i) => i.definitionName === options.definitionName);
    }
    if (options.status !== undefined) {
      results = results.filter((i) => i.status === options.status);
    }
    if (options.namespace !== undefined) {
      results = results.filter((i) => i.namespace === options.namespace);
    }
    if (options.dryRun !== undefined) {
      results = results.filter((i) => (i.dryRun === true) === options.dryRun);
    }
    results.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return results.slice(0, options.limit ?? 20);
  }

  async getByStatusAll(status: InstanceStatus): Promise<ProcessInstance[]> {
    return [...this.instances.values()].filter((i) => i.status === status);
  }

  async getByStatusInNamespaces(
    status: InstanceStatus,
    allowed: readonly string[],
  ): Promise<ProcessInstance[]> {
    return [...this.instances.values()].filter(
      (i) => i.status === status && allowed.includes(i.namespace ?? ''),
    );
  }

  async getByDefinition(
    name: string,
    version: string,
  ): Promise<ProcessInstance[]> {
    return [...this.instances.values()].filter(
      (i) => i.definitionName === name && i.definitionVersion === version,
    );
  }

  async getLastCompletedByDefinitionName(
    name: string,
  ): Promise<ProcessInstance | null> {
    // Mirrors the Firestore query shape: `deleted === false` excludes both
    // tombstoned runs (explicitly `true`) and pre-feature docs where the
    // field is missing. The schema's default(false) means real in-memory
    // reads materialize `false` for missing, but we keep the check strict
    // here to match what Firestore does on its own index.
    const matching = [...this.instances.values()].filter(
      (i) =>
        i.definitionName === name &&
        i.status === 'completed' &&
        i.deleted === false,
    );
    if (matching.length === 0) return null;
    matching.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return { ...matching[0] };
  }

  async addStepExecution(
    instanceId: string,
    execution: StepExecution,
  ): Promise<StepExecution> {
    const parsed = StepExecutionSchema.parse(execution);
    const executions = this.stepExecutions.get(instanceId) ?? [];
    executions.push({ ...parsed });
    this.stepExecutions.set(instanceId, executions);
    return { ...parsed };
  }

  async getStepExecutions(instanceId: string): Promise<StepExecution[]> {
    const executions = this.stepExecutions.get(instanceId) ?? [];
    return [...executions].sort(
      (a, b) =>
        new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
    );
  }

  async updateStepExecution(
    instanceId: string,
    executionId: string,
    updates: Partial<StepExecution>,
  ): Promise<void> {
    const executions = this.stepExecutions.get(instanceId) ?? [];
    const index = executions.findIndex((e) => e.id === executionId);
    if (index === -1) {
      throw new Error(`StepExecution not found: ${executionId}`);
    }
    executions[index] = { ...executions[index], ...updates };
  }

  async getLatestStepExecution(
    instanceId: string,
    stepId: string,
  ): Promise<StepExecution | null> {
    const executions = this.stepExecutions.get(instanceId) ?? [];
    const matching = executions.filter((e) => e.stepId === stepId);
    if (matching.length === 0) return null;
    return {
      ...matching.sort(
        (a, b) =>
          new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
      )[matching.length - 1],
    };
  }

  async getIdsByDefinitionName(namespace: string, name: string): Promise<string[]> {
    return [...this.instances.values()]
      .filter((i) => i.namespace === namespace && i.definitionName === name)
      .map((i) => i.id);
  }

  async setDeletedByDefinitionName(
    namespace: string,
    name: string,
    deleted: boolean,
  ): Promise<void> {
    for (const [id, instance] of this.instances) {
      if (instance.namespace !== namespace) continue;
      if (instance.definitionName !== name) continue;
      this.instances.set(id, { ...instance, deleted });
    }
  }

  async summarizeRunsByWorkflow(
    namespace: string,
    name: string,
    includeCompleted: boolean,
  ): Promise<WorkflowRunSummaryResult> {
    const scoped = [...this.instances.values()].filter(
      (i) =>
        i.namespace === namespace &&
        i.definitionName === name &&
        i.deleted !== true &&
        i.archived !== true,
    );
    const active = scoped.filter((i) => ACTIVE_STATUSES.has(i.status)).length;
    const counted = includeCompleted
      ? scoped
      : scoped.filter((i) => !TERMINAL_STATUSES.has(i.status));
    const latest = [...counted]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 3)
      .map((i) => ({ ...i }));
    return { total: counted.length, active, latest };
  }

  /** Test helper: clear all stored data */
  clear(): void {
    this.instances.clear();
    this.stepExecutions.clear();
  }

  /** Test helper: return all instances */
  getAll(): ProcessInstance[] {
    return [...this.instances.values()];
  }

  /** Test helper: return all step executions for an instance */
  getAllStepExecutions(instanceId: string): StepExecution[] {
    return [...(this.stepExecutions.get(instanceId) ?? [])];
  }
}
