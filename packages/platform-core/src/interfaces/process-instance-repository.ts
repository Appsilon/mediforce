import type { ProcessInstance } from '../schemas/process-instance';
import type { StepExecution } from '../schemas/step-execution';
import type { InstanceStatus } from '../schemas/process-instance';

export interface ListInstancesOptions {
  definitionName?: string;
  status?: InstanceStatus;
  /**
   * Workspace filter pushed into the storage layer. Set by handlers that
   * already know which workspace they're aggregating for (e.g. the
   * monitoring summary). Replaces a JS-side `r.namespace === handle`
   * pass over an over-fetched cross-workspace page — the Firestore
   * impl rewrites to a `where('namespace','==',ns)` so the wire payload
   * shrinks to the keep-set. Composed with `listInNamespaces`'s
   * `allowed` set under intersection semantics: a user caller asking
   * for a namespace they don't belong to gets an empty list back, not
   * an error.
   */
  namespace?: string;
  limit?: number;
}

/**
 * Per-workflow run aggregate for the workspace home cards. Computed without
 * shipping the whole run collection: `total` / `active` come from Firestore
 * count() aggregations (no document reads), `latest` from a bounded
 * `orderBy(createdAt desc).limit(3)` query.
 *
 * Always excludes soft-deleted (`deleted`) and user-archived (`archived`)
 * runs — the home cards never show either. `active` counts runs in
 * {running, created, paused} and is unaffected by `includeCompleted`. When
 * `includeCompleted` is false, `total` and `latest` exclude terminal
 * (completed / failed) runs.
 */
export interface WorkflowRunSummaryResult {
  total: number;
  active: number;
  latest: ProcessInstance[];
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

  /**
   * Cheap namespace lookup for gate-only callers (e.g. the human-task
   * wrapper resolving "which workspace does this task belong to?"). Reads
   * only the `namespace` field — no per-row schema parse — so one legacy
   * corrupt doc cannot 400 a fan-out call. Returns `null` if the doc is
   * missing or has no namespace.
   */
  getNamespaceById(instanceId: string): Promise<string | null>;

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

  /**
   * Per-workflow run aggregate for the workspace home cards. Scoped by
   * (`namespace`, `definitionName` == `name`). Uses count aggregations for
   * `total` / `active` (no document reads) plus a bounded latest-3 query — so
   * the home page never re-reads the whole run collection on every poll.
   */
  summarizeRunsByWorkflow(
    namespace: string,
    name: string,
    includeCompleted: boolean,
  ): Promise<WorkflowRunSummaryResult>;
}
