import type { InstanceStatus } from '@mediforce/platform-core';

/**
 * Polling cadences per ADR-0006 §4.
 *
 * NICE LIVE — low-change reads where 30 s freshness is plenty (workspace
 * dashboard summary, the run label map — only a brand-new run changes them).
 * STANDARD LIVE — list slices and queues the operator scans periodically.
 * CRITICAL LIVE — single-entity reads that drive sub-second decisions
 * (step execution, agent events while a run is non-terminal).
 *
 * Hooks gate `refetchInterval` on `q.state.error !== null` per PRD §9
 * rule 4 ("terminate on 4xx") so a deleted run / membership flip does
 * not tight-loop.
 */
export const NICE_LIVE_INTERVAL_MS = 30_000;
export const STANDARD_LIVE_INTERVAL_MS = 5_000;
export const CRITICAL_LIVE_INTERVAL_MS = 1_500;

export const TERMINAL_STATUSES: ReadonlySet<InstanceStatus> = new Set([
  'completed',
  'failed',
]);
