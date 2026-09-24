import {
  type AgentTrajectoryEntry,
  type AgentTrajectoryRepository,
  type StoredAgentTrajectoryEntry,
} from '@mediforce/platform-core';

const DEFAULT_FLUSH_INTERVAL_MS = 1_000;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const MAX_WRITE_ATTEMPTS = 3;

/**
 * Collects one Agent Run's trajectory from a plugin's output stream and writes
 * it in batches (ADR-0023 D8). `record` is synchronous so a stdout line
 * callback never waits on the database; writes are chained so entries land in
 * order. A failed write is retried before any later entry is written, so a
 * transient error leaves no hole; entries recorded meanwhile wait as one
 * backlog batch. A write that keeps failing is logged and dropped — a
 * trajectory is evidence about the run, never a reason to fail it.
 */
export class TrajectoryRecorder {
  private readonly flushIntervalMs: number;
  private readonly retryDelayMs: number;
  private pending: StoredAgentTrajectoryEntry[] = [];
  private nextSeq = 0;
  private writes: Promise<void> = Promise.resolve();
  private writeQueued = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly repository: AgentTrajectoryRepository,
    private readonly agentRunId: string,
    options: { flushIntervalMs?: number; retryDelayMs?: number } = {},
  ) {
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
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
    if (this.pending.length > 0 && this.writeQueued === false) {
      this.writeQueued = true;
      this.writes = this.writes.then(() => {
        this.writeQueued = false;
        const batch = this.pending;
        this.pending = [];
        return this.write(batch);
      });
    }
    return this.writes;
  }

  private async write(batch: StoredAgentTrajectoryEntry[]): Promise<void> {
    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
      try {
        await this.repository.append(this.agentRunId, batch);
        return;
      } catch (error: unknown) {
        if (attempt === MAX_WRITE_ATTEMPTS) {
          console.warn(
            `[trajectory] dropped ${batch.length} entr${batch.length === 1 ? 'y' : 'ies'} for agent run ${this.agentRunId} after ${MAX_WRITE_ATTEMPTS} attempts:`,
            error instanceof Error ? error.message : error,
          );
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * attempt));
      }
    }
  }
}
