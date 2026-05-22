import type { ProcessInstance } from '../schemas/process-instance.js';
import type { StepExecution } from '../schemas/step-execution.js';
import type { InstanceStatus } from '../schemas/process-instance.js';

export interface ListInstancesOptions {
  definitionName?: string;
  status?: InstanceStatus;
  limit?: number;
}

/**
 * Storage-layer authorization (ADR-0004): read methods come in pairs. The
 * unscoped variant (`listAll`, `getByStatusAll`, …) is for system actors —
 * Firestore implementations issue a single query with no namespace filter.
 * The namespace-scoped variant (`listInNamespaces`, …) takes the caller's
 * allowed namespaces and filters at the storage layer (in-memory under
 * Firestore today, `WHERE namespace = ANY($)` under Postgres tomorrow).
 *
 * `getById` stays unsplit — it returns the row or null; the
 * `getByIdInNamespaces` variant returns null when the row's namespace isn't
 * in `allowed`. Writes / step-execution sub-collection methods are not
 * namespace-aware; the wrapper layer guards them via `assertNamespaceWrite`.
 */
export interface ProcessInstanceRepository {
  create(instance: ProcessInstance): Promise<ProcessInstance>;

  // Read methods, paired (All = system actor; InNamespaces = namespace-scoped caller)
  getById(instanceId: string): Promise<ProcessInstance | null>;
  getByIdInNamespaces(instanceId: string, allowed: readonly string[]): Promise<ProcessInstance | null>;

  listAll(options: ListInstancesOptions): Promise<ProcessInstance[]>;
  listInNamespaces(allowed: readonly string[], options: ListInstancesOptions): Promise<ProcessInstance[]>;

  getByStatusAll(status: InstanceStatus): Promise<ProcessInstance[]>;
  getByStatusInNamespaces(status: InstanceStatus, allowed: readonly string[]): Promise<ProcessInstance[]>;

  update(instanceId: string, updates: Partial<ProcessInstance>): Promise<void>;
  getByDefinition(name: string, version: string): Promise<ProcessInstance[]>;

  /**
   * Most recently completed run of a workflow (by name, across versions),
   * ordered by updatedAt desc. Used by the previous-run-outputs resolver to
   * find the predecessor whose outputs feed `ProcessInstance.previousRun`.
   */
  getLastCompletedByDefinitionName(name: string): Promise<ProcessInstance | null>;

  // Step execution subcollection
  addStepExecution(
    instanceId: string,
    execution: StepExecution,
  ): Promise<StepExecution>;
  getStepExecutions(instanceId: string): Promise<StepExecution[]>;
  getLatestStepExecution(
    instanceId: string,
    stepId: string,
  ): Promise<StepExecution | null>;
  updateStepExecution(
    instanceId: string,
    executionId: string,
    updates: Partial<StepExecution>,
  ): Promise<void>;

  getIdsByDefinitionName(name: string): Promise<string[]>;
  setDeletedByDefinitionName(name: string, deleted: boolean): Promise<void>;
}
