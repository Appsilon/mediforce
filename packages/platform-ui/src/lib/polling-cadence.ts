import type { InstanceStatus } from '@mediforce/platform-core';

/**
 * Polling cadences per ADR-0006 §4.
 *
 * STANDARD LIVE — list slices and queues the operator scans periodically.
 * CRITICAL LIVE — single-entity reads that drive sub-second decisions
 * (step execution, agent events while a run is non-terminal).
 *
 * Hooks gate `refetchInterval` on `q.state.error !== null` per PRD §9
 * rule 4 ("terminate on 4xx") so a deleted run / membership flip does
 * not tight-loop.
 */
export const STANDARD_LIVE_INTERVAL_MS = 5_000;
export const CRITICAL_LIVE_INTERVAL_MS = 1_500;

export const TERMINAL_STATUSES: ReadonlySet<InstanceStatus> = new Set([
  'completed',
  'failed',
]);

/**
 * Workaround cap shared by every legacy `runs.list({})` call that mirrors
 * the pre-Phase-4 Firestore `onSnapshot` (which loaded the entire collection
 * with no upper bound). Tracked by issue #588 — drop once `runs.list`
 * exposes proper pagination on the contract.
 */
export const LEGACY_FIRESTORE_PARITY_LIMIT = 10_000;
