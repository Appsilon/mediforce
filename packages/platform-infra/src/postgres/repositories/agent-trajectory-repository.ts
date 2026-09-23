import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import {
  StoredAgentTrajectoryEntrySchema,
  type AgentTrajectoryReadOptions,
  type AgentTrajectoryRepository,
  type StoredAgentTrajectoryEntry,
} from '@mediforce/platform-core';
import type { Database } from '../client';
import { agentRuns } from '../schema/agent-run';
import { agentTrajectoryEntries } from '../schema/agent-trajectory';

/**
 * Postgres-backed Agent Trajectories. Appends ignore a repeated `(run, seq)`;
 * reads check the parent `agent_runs` row first so an unknown or out-of-scope
 * run is `null`, distinct from a run that recorded nothing (`[]`).
 */
export class PostgresAgentTrajectoryRepository implements AgentTrajectoryRepository {
  constructor(private readonly db: Database) {}

  async append(agentRunId: string, entries: readonly StoredAgentTrajectoryEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.db
      .insert(agentTrajectoryEntries)
      .values(entries.map(({ seq, ...entry }) => ({ agentRunId, seq, entry })))
      .onConflictDoNothing();
  }

  async list(
    agentRunId: string,
    options: AgentTrajectoryReadOptions = {},
  ): Promise<StoredAgentTrajectoryEntry[] | null> {
    const runs = await this.db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(eq(agentRuns.id, agentRunId))
      .limit(1);
    if (runs[0] === undefined) return null;
    return this.entriesOf(agentRunId, options);
  }

  async listInNamespaces(
    agentRunId: string,
    allowed: readonly string[],
    options: AgentTrajectoryReadOptions = {},
  ): Promise<StoredAgentTrajectoryEntry[] | null> {
    if (allowed.length === 0) return null;
    const runs = await this.db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(and(eq(agentRuns.id, agentRunId), inArray(agentRuns.workspace, [...allowed])))
      .limit(1);
    if (runs[0] === undefined) return null;
    return this.entriesOf(agentRunId, options);
  }

  private async entriesOf(
    agentRunId: string,
    { afterSeq }: AgentTrajectoryReadOptions,
  ): Promise<StoredAgentTrajectoryEntry[]> {
    const rows = await this.db
      .select({ seq: agentTrajectoryEntries.seq, entry: agentTrajectoryEntries.entry })
      .from(agentTrajectoryEntries)
      .where(and(
        eq(agentTrajectoryEntries.agentRunId, agentRunId),
        afterSeq === undefined ? undefined : gt(agentTrajectoryEntries.seq, afterSeq),
      ))
      .orderBy(asc(agentTrajectoryEntries.seq));
    return rows.map((row) =>
      StoredAgentTrajectoryEntrySchema.parse({ ...(row.entry as Record<string, unknown>), seq: row.seq }),
    );
  }
}
