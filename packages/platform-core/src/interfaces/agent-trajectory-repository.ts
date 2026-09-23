import type { StoredAgentTrajectoryEntry } from '../schemas/agent-trajectory';

/**
 * Agent Trajectories (ADR-0023 D8), keyed by `agentRunId`. Append-only: the
 * runner is the one writer per Agent Run and numbers entries itself, so an
 * append that repeats a `seq` is ignored rather than duplicated.
 *
 * Reads return `null` when the Agent Run does not exist (or, for the
 * `InNamespaces` variant, lives outside `allowed`), and `[]` when it exists but
 * recorded nothing — a mocked run, or a plugin with no stream to record.
 */
export interface AgentTrajectoryRepository {
  append(agentRunId: string, entries: readonly StoredAgentTrajectoryEntry[]): Promise<void>;
  list(agentRunId: string): Promise<StoredAgentTrajectoryEntry[] | null>;
  listInNamespaces(
    agentRunId: string,
    allowed: readonly string[],
  ): Promise<StoredAgentTrajectoryEntry[] | null>;
}
