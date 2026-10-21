import type { StepExecution } from '@mediforce/platform-core';
import { edgeIdOf } from './workflow-graph-layout';

/** How long the ball waits at each step: in proportion to the time the run
 *  really spent there, or the same short beat everywhere (the path only). */
export type ReplayPacing = 'proportional' | 'journey';

/** One move of the ball, from the step that ran to the step that ran next. */
export interface ReplayHop {
  from: string;
  to: string;
  /** Diagram edge the ball rides along; null when the diagram draws no arrow
   *  between the two steps, and the ball jumps instead. */
  edgeId: string | null;
  /** Real time the run spent at `from` before `to` started. */
  realGapMs: number;
}

export const REPLAY_TRAVEL_MS = 600;
export const JOURNEY_DWELL_MS = 250;
/** Total dwell time a proportional replay is squeezed into, whatever the real run length. */
export const PROPORTIONAL_TOTAL_DWELL_MS = 20_000;

/** The path a run took: the step it started at, and every hop after it, in start order. */
export interface ReplayPath {
  firstStepId: string | null;
  hops: ReplayHop[];
}

export function buildReplayPath(executions: StepExecution[], edgeIds: ReadonlySet<string>): ReplayPath {
  const ordered = [...executions].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const hops: ReplayHop[] = [];
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const edgeId = edgeIdOf(previous.stepId, current.stepId);
    hops.push({
      from: previous.stepId,
      to: current.stepId,
      edgeId: edgeIds.has(edgeId) ? edgeId : null,
      realGapMs: Math.max(0, Date.parse(current.startedAt) - Date.parse(previous.startedAt)),
    });
  }
  return { firstStepId: ordered.length > 0 ? ordered[0].stepId : null, hops };
}

/** Dwell at each hop's source step, before the ball sets off. */
export function replayDwellsMs(hops: ReplayHop[], pacing: ReplayPacing): number[] {
  if (pacing === 'journey') return hops.map(() => JOURNEY_DWELL_MS);
  const totalGapMs = hops.reduce((sum, hop) => sum + hop.realGapMs, 0);
  if (totalGapMs === 0) return hops.map(() => JOURNEY_DWELL_MS);
  return hops.map((hop) => (hop.realGapMs / totalGapMs) * PROPORTIONAL_TOTAL_DWELL_MS);
}
