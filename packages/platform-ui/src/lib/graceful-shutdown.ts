// Deploy fast-path for stranded runs (ADR-0010 §4).
//
// Staging redeploys `platform-ui` on every merge to `main`, and agent steps run
// 20–30 min, so a deploy landing mid-step is common. The #906 timeout-reap
// eventually recovers such a run, but only after `stepTimeout + grace` (~45 min)
// and by resolving it as a *timeout failure* — dishonest, because the step was
// merely interrupted by a deploy.
//
// This module collapses that into a seconds-long retry:
//
//   1. On SIGTERM (the signal `docker stop` / the orchestrator sends before the
//      ~10s SIGKILL grace), mark every in-flight step execution `interrupted` —
//      a handful of cheap DB writes, well within the grace window.
//   2. On the next boot, immediately re-kick any run whose current execution is
//      `interrupted`, so the auto-runner retries it with a fresh attempt (its
//      retry branch) instead of waiting out the timeout.
//
// The timeout-reap stays the backstop for deaths SIGTERM can't observe (SIGKILL,
// OOM, hard crash) — there the execution stays `running` and the heartbeat sweep
// reaps it as a timeout, exactly as before.
//
// NOTE (verify on staging): the SIGTERM handler and the boot self-fetch can only
// be meaningfully exercised against a real deploy — see the ADR. The pure
// helpers below are unit-tested; the wiring is not.

import { createHttpSelfFetchRunKicker, type RunKicker } from '@mediforce/platform-api/runtime';
import type { ProcessInstanceRepository } from '@mediforce/platform-core';
import { getPlatformServices } from './platform-services';
import { getAppBaseUrl } from './app-base-url';
import { snapshotInFlight } from './in-flight-registry';

const INTERRUPT_ERROR =
  'Interrupted by platform-ui shutdown (deploy) — will retry on next boot';

/** Seconds to wait after boot before the re-kick sweep self-fetches `/run` —
 *  the HTTP server isn't listening yet when `register()` runs, so the sweep is
 *  deferred until it is. Overridable for a slower cold start. */
const BOOT_REKICK_DELAY_MS = (() => {
  const parsed = Number(process.env.BOOT_REKICK_DELAY_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5_000;
})();

type ShutdownInstanceRepo = Pick<ProcessInstanceRepository, 'updateStepExecution'>;

export interface MarkInterruptedDeps {
  instanceRepo: ShutdownInstanceRepo;
  inFlight: () => ReadonlyArray<readonly [string, string]>;
  now?: () => Date;
}

/**
 * Mark every currently in-flight `(instanceId, executionId)` as `interrupted`.
 * Best-effort: writes run in parallel and settle independently so one slow /
 * failing write cannot starve the others before SIGKILL lands. Returns the
 * number of executions successfully marked.
 */
export async function markInFlightExecutionsInterrupted(
  deps: MarkInterruptedDeps,
): Promise<number> {
  const entries = deps.inFlight();
  if (entries.length === 0) return 0;

  const completedAt = (deps.now ?? (() => new Date()))().toISOString();
  const results = await Promise.allSettled(
    entries.map(([instanceId, executionId]) =>
      deps.instanceRepo.updateStepExecution(instanceId, executionId, {
        status: 'interrupted',
        completedAt,
        error: INTERRUPT_ERROR,
      }),
    ),
  );

  const marked = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - marked;
  if (failed > 0) {
    console.error(
      `[shutdown] ${failed}/${results.length} in-flight execution(s) could not be marked interrupted — ` +
      `the timeout-reap backstop will recover them`,
    );
  }
  return marked;
}

type BootSweepInstanceRepo = Pick<
  ProcessInstanceRepository,
  'getByStatusAll' | 'getLatestStepExecution'
>;

export interface RekickInterruptedDeps {
  instanceRepo: BootSweepInstanceRepo;
  runKicker: RunKicker;
}

/**
 * Re-kick every `running` instance whose current step's latest execution is
 * `interrupted`. Idempotent via the auto-runner's per-process run-lock (a live
 * driver 409s the POST); at boot no driver is live, so the re-kick re-enters
 * `/run`, which dispatches a fresh attempt for the interrupted step. Returns the
 * ids re-kicked.
 */
export async function rekickInterruptedRuns(
  deps: RekickInterruptedDeps,
): Promise<string[]> {
  const running = await deps.instanceRepo.getByStatusAll('running');
  const rekicked: string[] = [];

  for (const inst of running) {
    if (inst.currentStepId === null) continue;
    const latest = await deps.instanceRepo.getLatestStepExecution(inst.id, inst.currentStepId);
    if (latest?.status !== 'interrupted') continue;

    await deps.runKicker.kick(inst.id, { triggeredBy: 'boot-rekick-interrupted' });
    rekicked.push(inst.id);
    console.log(
      `[boot-rekick] Re-kicked deploy-interrupted run '${inst.id}' at step '${inst.currentStepId}' for immediate retry`,
    );
  }

  return rekicked;
}

let shutdownRegistered = false;
let shuttingDown = false;

/**
 * Install the SIGTERM handler that marks in-flight executions interrupted before
 * the process exits. Idempotent — safe to call once from `register()`.
 */
export function registerGracefulShutdown(): void {
  if (shutdownRegistered) return;
  shutdownRegistered = true;

  process.on('SIGTERM', () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void (async () => {
      try {
        const { instanceRepo } = getPlatformServices();
        const marked = await markInFlightExecutionsInterrupted({
          instanceRepo,
          inFlight: snapshotInFlight,
        });
        console.log(`[shutdown] SIGTERM — marked ${marked} in-flight step execution(s) interrupted`);
      } catch (err) {
        console.error('[shutdown] SIGTERM handler failed:', err);
      } finally {
        process.exit(0);
      }
    })();
  });
}

/**
 * Schedule the boot re-kick sweep. Deferred by {@link BOOT_REKICK_DELAY_MS} so
 * the self-fetching run-kicker hits a listening server (the HTTP server isn't up
 * yet when `register()` runs). Fire-and-forget — never blocks boot.
 */
export function scheduleBootRekickSweep(): void {
  const runKicker: RunKicker = createHttpSelfFetchRunKicker({
    baseUrl: getAppBaseUrl,
    apiKey: () => process.env.PLATFORM_API_KEY ?? '',
  });

  const timer = setTimeout(() => {
    void (async () => {
      try {
        const { instanceRepo } = getPlatformServices();
        const rekicked = await rekickInterruptedRuns({ instanceRepo, runKicker });
        if (rekicked.length > 0) {
          console.log(`[boot-rekick] Re-kicked ${rekicked.length} deploy-interrupted run(s) on boot`);
        }
      } catch (err) {
        console.error('[boot-rekick] boot sweep failed:', err);
      }
    })();
  }, BOOT_REKICK_DELAY_MS);
  // Don't keep the event loop alive solely for this timer.
  timer.unref?.();
}
