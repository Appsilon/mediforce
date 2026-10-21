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

/** `terminalStepIds` is null while the run has not completed. The engine records no
 *  execution for the terminal step a completed run reached, so its hop is read off
 *  the last step's routing, or the only terminal step that step has an arrow to. */
export function buildReplayPath(
  executions: StepExecution[],
  edgeIds: ReadonlySet<string>,
  terminalStepIds: ReadonlySet<string> | null = null,
): ReplayPath {
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
  const last = ordered.at(-1);
  const terminalStepId = last !== undefined && terminalStepIds !== null ? terminalStepAfter(last, edgeIds, terminalStepIds) : null;
  if (last !== undefined && terminalStepId !== null) {
    const edgeId = edgeIdOf(last.stepId, terminalStepId);
    hops.push({
      from: last.stepId,
      to: terminalStepId,
      edgeId: edgeIds.has(edgeId) ? edgeId : null,
      realGapMs: last.completedAt !== null ? Math.max(0, Date.parse(last.completedAt) - Date.parse(last.startedAt)) : 0,
    });
  }
  return { firstStepId: ordered.length > 0 ? ordered[0].stepId : null, hops };
}

function terminalStepAfter(
  last: StepExecution,
  edgeIds: ReadonlySet<string>,
  terminalStepIds: ReadonlySet<string>,
): string | null {
  const routedTo = last.gateResult?.next;
  if (routedTo !== undefined && terminalStepIds.has(routedTo)) return routedTo;
  const reachable = [...terminalStepIds].filter((stepId) => edgeIds.has(edgeIdOf(last.stepId, stepId)));
  return reachable.length === 1 ? reachable[0] : null;
}

/** Dwell at each hop's source step, before the ball sets off. */
export function replayDwellsMs(hops: ReplayHop[], pacing: ReplayPacing): number[] {
  if (pacing === 'journey') return hops.map(() => JOURNEY_DWELL_MS);
  const totalGapMs = hops.reduce((sum, hop) => sum + hop.realGapMs, 0);
  if (totalGapMs === 0) return hops.map(() => JOURNEY_DWELL_MS);
  return hops.map((hop) => (hop.realGapMs / totalGapMs) * PROPORTIONAL_TOTAL_DWELL_MS);
}
