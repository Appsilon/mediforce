import type { CallerScope } from '../../repositories/index';
import { PreconditionFailedError } from '../../errors';
import { resumeWait } from './resume-wait';

async function resumeIfWaiting(runId: string, scope: CallerScope): Promise<void> {
  try {
    await resumeWait({ runId }, scope);
  } catch (err) {
    if (!(err instanceof PreconditionFailedError)) {
      console.error(`[settle-run-waits] Failed to resume '${runId}':`, err);
    }
  }
}

/**
 * A run just stopped driving itself (finished, failed, or paused on a wait):
 * re-check the waits that depend on it, so a join resumes the moment its last
 * child ends instead of on the next heartbeat.
 *
 * - A finished child may be the last one its parent's `children.*` wait needs.
 * - A run that paused on its own wait may have spawned children that all ended
 *   before the pause was written, so no later child ending will wake it.
 *
 * Best-effort and never throws: the run has already stopped, and the heartbeat
 * sweep still resumes anything a failure here misses.
 */
export async function settleRunWaits(runId: string, scope: CallerScope): Promise<void> {
  try {
    await resumeWaitsAround(runId, scope);
  } catch (err) {
    console.error(`[settle-run-waits] Failed to settle the waits around '${runId}':`, err);
  }
}

async function resumeWaitsAround(runId: string, scope: CallerScope): Promise<void> {
  const run = await scope.runs.getById(runId);
  if (run === null) return;

  if (run.status === 'paused' && run.pauseReason === 'waiting_for_timer') {
    await resumeIfWaiting(run.id, scope);
  }

  const hasEnded = run.status === 'completed' || run.status === 'failed';
  if (hasEnded && run.parentInstanceId !== undefined) {
    await resumeIfWaiting(run.parentInstanceId, scope);
  }
}
