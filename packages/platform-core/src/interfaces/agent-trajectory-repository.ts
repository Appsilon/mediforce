import type { StoredAgentTrajectoryEntry } from '../schemas/agent-trajectory';

/**
 * Agent Trajectories (ADR-0023 D8), keyed by `agentRunId`. Append-only: the
 * runner is the one writer per Agent Run and numbers entries itself, so an
 * append that repeats a `seq` is ignored rather than duplicated.
 *
 * Reads return `null` when the Agent Run does not exist (or, for the
 * `InNamespaces` variant, lives outside `allowed`), and `[]` when it exists but
 * recorded nothing — a mocked run, or a plugin with no stream to record.
 * `afterSeq` narrows a read to the entries with a greater `seq`, so a live
 * viewer fetches only what it has not seen.
 */
export interface AgentTrajectoryReadOptions {
  readonly afterSeq?: number;
}

export interface AgentTrajectoryRepository {
  append(agentRunId: string, entries: readonly StoredAgentTrajectoryEntry[]): Promise<void>;
  list(agentRunId: string, options?: AgentTrajectoryReadOptions): Promise<StoredAgentTrajectoryEntry[] | null>;
  listInNamespaces(
    agentRunId: string,
    allowed: readonly string[],
    options?: AgentTrajectoryReadOptions,
  ): Promise<StoredAgentTrajectoryEntry[] | null>;
}
