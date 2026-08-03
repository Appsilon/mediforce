import type { AgentRun, AgentRunStatus, AgentRunCardStatus } from '../schemas/agent-run';

export interface ListAgentRunsOptions {
  readonly limit: number;
  readonly cursor?: string;
  readonly runId?: string;
  readonly stepId?: string;
  /** Optional explicit namespace filter (further narrows inside `allowed`). */
  readonly namespace?: string;
  /** Raw status filter — the Monitoring → Agents tab's "All Statuses" dropdown. */
  readonly status?: AgentRunStatus;
  /** KPI-card bucket filter (see `AgentRunCardStatusSchema`'s docstring) —
   *  what clicking a Monitoring → Agents KPI card narrows the table to.
   *  Composable with `status`: both apply if both are set. */
  readonly cardStatus?: AgentRunCardStatus;
  /** Workflow-name filter, resolved client-side (via the already-fetched
   *  processInstanceId → definitionName map) into the matching instance
   *  ids — avoids a repository-level join against process_instances. */
  readonly processInstanceIds?: readonly string[];
}

export interface ListAgentRunsPage {
  readonly items: readonly AgentRun[];
  readonly nextCursor?: string;
}

/** Grouped `AgentRunCardStatus` counts for the Agents tab's KPI cards. */
export type AgentRunCardStatusCounts = Record<AgentRunCardStatus, number> & { total: number };

/**
 * Storage-layer authorization (ADR-0004): agent runs have no namespace field —
 * workspace is reached via the parent `ProcessInstance`.
 */
export interface AgentRunRepository {
  create(run: AgentRun): Promise<AgentRun>;
  update(runId: string, updates: Partial<AgentRun>): Promise<void>;

  getById(runId: string): Promise<AgentRun | null>;
  getByIdInNamespaces(runId: string, allowed: readonly string[]): Promise<AgentRun | null>;

  getByInstanceId(instanceId: string): Promise<AgentRun[]>;
  getByInstanceIdInNamespaces(instanceId: string, allowed: readonly string[]): Promise<AgentRun[]>;

  getAll(limitN?: number): Promise<AgentRun[]>;

  /** System-actor list — no workspace filter. Sorted by startedAt desc. */
  list(opts: ListAgentRunsOptions): Promise<ListAgentRunsPage>;

  /**
   * Workspace-scoped list — items whose parent `ProcessInstance.namespace` is
   * in `allowed`. Sorted by startedAt desc with `(startedAt, id)` tie-break.
   */
  listInNamespaces(
    allowed: readonly string[],
    opts: ListAgentRunsOptions,
  ): Promise<ListAgentRunsPage>;

  /** Grouped `AgentRunCardStatus` counts (system-actor) — same
   *  `namespace`/`processInstanceIds`/`status` filters as `list` minus
   *  `cardStatus` itself and pagination, so a KPI card's number always
   *  matches what clicking it would filter the table to. */
  countByCardStatus(
    opts: Pick<ListAgentRunsOptions, 'namespace' | 'processInstanceIds' | 'status'>,
  ): Promise<AgentRunCardStatusCounts>;
  /** Namespace-scoped variant. */
  countByCardStatusInNamespaces(
    allowed: readonly string[],
    opts: Pick<ListAgentRunsOptions, 'namespace' | 'processInstanceIds' | 'status'>,
  ): Promise<AgentRunCardStatusCounts>;
}
