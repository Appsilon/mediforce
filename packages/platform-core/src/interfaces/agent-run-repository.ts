import type { AgentRun } from '../schemas/agent-run';

export interface ListAgentRunsOptions {
  readonly limit: number;
  readonly cursor?: string;
  readonly runId?: string;
  readonly stepId?: string;
  /** Optional explicit namespace filter (further narrows inside `allowed`). */
  readonly namespace?: string;
}

export interface ListAgentRunsPage {
  readonly items: readonly AgentRun[];
  readonly nextCursor?: string;
}

/**
 * Storage-layer authorization (ADR-0004): agent runs have no namespace field —
 * workspace is reached via the parent `ProcessInstance`.
 */
export interface AgentRunRepository {
  create(run: AgentRun): Promise<AgentRun>;

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
  listInNamespaces(allowed: readonly string[], opts: ListAgentRunsOptions): Promise<ListAgentRunsPage>;
}
