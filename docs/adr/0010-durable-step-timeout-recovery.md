# ADR-0010: Durable Step Timeout & Stranded-Run Recovery

**Status:** Accepted
**Date:** 2026-07-15
**Deciders:** Krystian Zielinski
**Context issue:** [#868](https://github.com/Appsilon/mediforce/issues/868)

## Context

An agent/script step's timeout is enforced only by an in-process `Promise.race`
in `PluginRunner.execute`. That timer lives in whatever process is awaiting the
step — which, in production, is the auto-runner loop inside Next.js `after()`
(request-scoped background work in `api/processes/[instanceId]/run/route.ts`).
When that `platform-ui` process is recycled — a deploy (staging redeploys on
every merge to `main`, and agent steps run 20–30 min so a deploy landing
mid-step is common, not rare), a crash, or an OOM — the timer dies with it. The
step stays `running` forever, the timeout fallback never fires, and the run is
stranded (#868).

A partial recovery already existed before this ADR: the cron **heartbeat**
(`platform-api` `handlers/cron/heartbeat.ts`, driven by an out-of-band ~15-min
external POST to `/api/cron/heartbeat`) sweeps runs stuck in `running` past
`resolveStepTimeoutMinutes(step) + 15 min` grace and **re-kicks** them
(`runKicker.kick` → POST `/run`, idempotent via the in-memory run-lock 409).
But re-kick **re-runs** the step from scratch rather than firing the timeout
fallback: it never escalates/fails per `fallbackBehavior`, it orphans the
original `running` `StepExecution`/`AgentRun` rows, and — because the per-`/run`
loop-guard resets on every re-kick — a perpetually-stuck step could be
re-kicked forever.

## Decision

Make the timeout **durable** by treating "stranded past deadline" and
"timed out" as the same event, recovered through the existing fallback path.

1. **Reap, don't restart (executor-owned).** On re-entry, the step executor
   (`AgentStepExecutor` / `ScriptStepExecutor`) performs resume-detection:
   if a prior non-terminal `StepExecution` for the step exists, it is reaped
   rather than a fresh attempt spawned. A `running` execution older than
   `resolveStepTimeoutMinutes` is reaped as **timeout** — routed through the
   existing `FallbackHandler` (`fallbackReason='timeout'`, terminal `AgentRun`,
   escalate/fail per `fallbackBehavior`; scripts fail deterministically since
   they have no escalation path per ADR-0008). This reuses the exact code path
   the live-driver `Promise.race` timeout takes, so alive-driver and dead-driver
   timeouts converge on identical behaviour, and it terminates the orphaned rows
   as a side effect. The auto-runner loop gains a pre-dispatch guard (symmetric
   to its existing human-task / cowork guards) so it hands an existing in-flight
   execution to the executor instead of creating a new row.

2. **The heartbeat sweep is only an alarm clock.** It keeps detecting overdue
   `running` runs and re-kicking, but no longer decides step semantics — the
   re-entered driver does. This keeps the in-memory run-lock as the single-writer
   guard (no cross-process lock needed) while the reap becomes the source of
   truth.

3. **Termination guarantee.** Reaping moves the run out of `running`
   (`paused`/`failed`, or advances on `continue_with_flag`); the sweep only
   queries `running`, so a reaped run is structurally un-re-kickable. The two
   paths that legitimately re-run — SIGTERM-interrupted retry (below) and
   `action`-step re-dispatch — are bounded by a **persisted**
   `MAX_STEP_ATTEMPTS` cap on the `(run, stepId)` execution count (unlike the
   in-memory loop-guard, this survives process death and re-kicks). Exceeding it
   fails the run. No step type can loop forever.

4. **SIGTERM fast-path for deploys.** *(Shipped in #907, follow-up to the
   initial #868/#906 implementation.)* A `SIGTERM` graceful-shutdown hook on
   `platform-ui` (wired in `instrumentation.register()`) marks its in-flight
   runs' current execution `interrupted` (a new `StepExecution` status) before
   the process exits — a handful of cheap DB writes within the ~10s stop grace,
   driven by a shared in-flight registry (`instanceId → executionId`, backed by
   `globalThis` so the shutdown hook and the auto-runner share one map across
   Next's separate instrumentation/route bundles). A boot-time re-kick sweep
   then recovers them **immediately** as a **retry** (we know it was a deploy,
   not a genuine timeout), collapsing the ~45-min "hang then fail" into a
   seconds-long retry; the auto-runner's reap guard treats an `interrupted`
   prior execution as a fresh attempt rather than a timeout-reap, bounded by the
   same `MAX_STEP_ATTEMPTS` cap (the interrupted row counts). The timeout-reap is
   the backstop for deaths SIGTERM can't observe (SIGKILL, OOM, crash).

5. **Single-source timeout.** `resolveStepTimeoutMinutes(step)` is the one
   source feeding both the `PluginRunner` `Promise.race` and the container-kill
   timer (in-process spawn strategy **and** the BullMQ worker). This closes the
   `DEFAULT_TIMEOUT_MS = 20 min` vs `resolveStepTimeoutMinutes` default `30 min`
   wiring gap, under which an unconfigured step was SIGKILLed at 20 min and
   misclassified as `error` instead of `timeout`. The script-container plugin's
   own legacy last-resort default (`10 min`) is aligned to `30 min` for the same
   reason, so no plugin's fallback silently disagrees with the resolver default.

## Alternatives considered

- **Sweep fires the fallback directly** (heartbeat transitions the step itself):
  the run-lock is an in-memory `Set` in the Next.js process, invisible to the
  `platform-api` handler, so this needs a *new* cross-process lock/lease to
  avoid racing a still-alive driver — the large architectural surface #868's
  triage flagged. Rejected in favour of keeping one writer (the re-entered
  driver).
- **Persisted `deadlineAt` column** on the agent-run/step row: a migration and a
  schema field for something derivable from the already-persisted
  `StepExecution.startedAt + timeout`. No durability benefit. Rejected.
- **Keep re-kick-as-retry:** silently retries a timed-out step instead of
  honouring `fallbackBehavior`, and (loop-guard resetting per re-kick) risks
  infinite retries. Rejected — a step past its deadline *is* a timeout.

## Consequences

- Alive-driver and dead-driver timeouts are now the same code path — behaviour
  can't drift between them.
- Orphaned `running` `StepExecution`/`AgentRun` rows are terminated on reap
  (observability fix).
- `action` steps still have **no timeout mechanism** (they bypass
  `PluginRunner`); a stranded action is re-dispatched and bounded only by
  `MAX_STEP_ATTEMPTS`. Giving actions a real timeout is a tracked follow-up.
- **Cancellation of orphaned compute is descoped.** In worker mode (staging /
  prod) the `container-worker` process is independent of `platform-ui` and its
  own kill timer reaps the container on a `platform-ui`-only recycle; a full
  deploy that also restarts the worker can still orphan a container under
  `dockerd`, but that is a compute leak, not a run-correctness bug. Durable
  `docker kill` / Databricks-cancel from the sweep is a tracked follow-up.
- The whole durability chain assumes something actually POSTs
  `/api/cron/heartbeat` on a schedule (host cron / uptime monitor, out of repo).
  If that scheduler is absent, nothing is durable — an operational precondition,
  not a code guarantee.
