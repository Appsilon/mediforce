import type { AgentRunRepository } from '../interfaces/agent-run-repository';
import type {
  AgentTrajectoryReadOptions,
  AgentTrajectoryRepository,
} from '../interfaces/agent-trajectory-repository';
import type { StoredAgentTrajectoryEntry } from '../schemas/agent-trajectory';

export class InMemoryAgentTrajectoryRepository implements AgentTrajectoryRepository {
  private readonly entriesByRun = new Map<string, Map<number, StoredAgentTrajectoryEntry>>();

  constructor(private readonly agentRuns: AgentRunRepository) {}

  async append(agentRunId: string, entries: readonly StoredAgentTrajectoryEntry[]): Promise<void> {
    const bySeq = this.entriesByRun.get(agentRunId) ?? new Map<number, StoredAgentTrajectoryEntry>();
    for (const entry of entries) {
      if (!bySeq.has(entry.seq)) bySeq.set(entry.seq, entry);
    }
    this.entriesByRun.set(agentRunId, bySeq);
  }

  async list(
    agentRunId: string,
    options: AgentTrajectoryReadOptions = {},
  ): Promise<StoredAgentTrajectoryEntry[] | null> {
    if ((await this.agentRuns.getById(agentRunId)) === null) return null;
    return this.sorted(agentRunId, options);
  }

  async listInNamespaces(
    agentRunId: string,
    allowed: readonly string[],
    options: AgentTrajectoryReadOptions = {},
  ): Promise<StoredAgentTrajectoryEntry[] | null> {
    if ((await this.agentRuns.getByIdInNamespaces(agentRunId, allowed)) === null) return null;
    return this.sorted(agentRunId, options);
  }

  private sorted(agentRunId: string, { afterSeq }: AgentTrajectoryReadOptions): StoredAgentTrajectoryEntry[] {
    const bySeq = this.entriesByRun.get(agentRunId);
    if (bySeq === undefined) return [];
    return [...bySeq.values()]
      .filter((entry) => afterSeq === undefined || entry.seq > afterSeq)
      .sort((left, right) => left.seq - right.seq);
  }
}
