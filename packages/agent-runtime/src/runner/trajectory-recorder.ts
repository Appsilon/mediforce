import {
  type AgentTrajectoryEntry,
  type AgentTrajectoryRepository,
  type StoredAgentTrajectoryEntry,
} from '@mediforce/platform-core';

const DEFAULT_FLUSH_INTERVAL_MS = 1_000;

/**
 * Collects one Agent Run's trajectory from a plugin's output stream and writes
 * it in batches (ADR-0023 D8). `record` is synchronous so a stdout line
 * callback never waits on the database; writes are chained so entries land in
 * order, and a failed write is logged and dropped — a trajectory is evidence
 * about the run, never a reason to fail it.
 */
export class TrajectoryRecorder {
  private readonly flushIntervalMs: number;
  private pending: StoredAgentTrajectoryEntry[] = [];
  private nextSeq = 0;
  private writes: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly repository: AgentTrajectoryRepository,
    private readonly agentRunId: string,
    options: { flushIntervalMs?: number } = {},
  ) {
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  }

  record(entries: readonly AgentTrajectoryEntry[]): void {
    for (const entry of entries) {
      this.pending.push({ ...entry, seq: this.nextSeq });
      this.nextSeq += 1;
    }
    if (this.pending.length > 0 && this.timer === null) {
      this.timer = setTimeout(() => {
        void this.flush();
      }, this.flushIntervalMs);
    }
  }

  /** Write everything recorded so far; resolves once it has landed (or failed). */
  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = this.pending;
    this.pending = [];
    if (batch.length > 0) {
      this.writes = this.writes.then(() =>
        this.repository.append(this.agentRunId, batch).catch((error: unknown) => {
          console.warn(
            `[trajectory] dropped ${batch.length} entr${batch.length === 1 ? 'y' : 'ies'} for agent run ${this.agentRunId}:`,
            error instanceof Error ? error.message : error,
          );
        }),
      );
    }
    return this.writes;
  }
}
