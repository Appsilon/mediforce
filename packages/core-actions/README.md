# @mediforce/core-actions

Handlers for `executor: 'action'` steps — the deterministic built-ins a workflow
gets without a container, an image, or an LLM.

| Kind | Does |
|---|---|
| `http` | Calls an HTTP endpoint, returns status and parsed body |
| `reshape` | Restructures earlier step output into a new shape |
| `email` | Sends email, with rate limiting |
| `spawn` | Starts one or more child workflow runs; `forEach` fans out one per item |
| `wait` | Suspends the run until a `duration` elapses or a `deadline` passes; an optional `condition` can resume it early |
| `collect` | Returns what the run's spawned children produced — status, error and one step's output (or all variables) per child |
| `run-workflow` | Starts one child workflow, suspends until it ends or `timeout` passes, and returns that child's result |

## Why these are not scripts

An action step needs no Docker image and no build. A workflow that only has to
call an API and reshape the response runs with nothing installed, which keeps
the cheap cases cheap — spinning up a container to make one HTTP request is
overhead a workflow author should not have to pay.

## Interpolation

Action configs interpolate against `${steps.*}`, `${variables.*}`,
`${triggerPayload.*}`, `${triggerContext.*}` and `${secrets.*}` — see
`src/interpolation.ts` and `InterpolationSources` in `platform-core`.

**Secret references are validated before the run starts.**
`validateActionSecrets` walks every action config, extracts each
`${secrets.NAME}`, and reports the ones that are not configured together with
the steps that need them. A workflow missing a credential fails at validation
with a list, rather than halfway through a run with one `undefined`.

## Registering

`ActionRegistry` is populated in
`packages/platform-api/src/services/platform-services.ts`. `email` registers only
when an email sender is configured — an unconfigured action is not offered
rather than failing at run time.

## `spawn`, `wait`, `collect` and `run-workflow`

Fan-out is one child *workflow* per item, not one step repeated N times — the
rejected alternatives and the parent→child linkage are in
[ADR-0018](../../docs/adr/0018-fan-out-is-child-workflows.md).

Handlers are pure functions and cannot pause a run, so `wait` returns a
`__wait` sentinel and the auto-runner — which owns lifecycle transitions —
intercepts it. Resuming is a separate `resumeWait` handler rather than part of
the auto-runner loop, because that loop rejects non-running instances. It is
event-driven: when the auto-runner stops driving a run, a task or cowork session
finishes one, it is cancelled, or the heartbeat fails it as orphaned, `settleRunWaits` re-checks the wait of its parent (a child that just ended may
be the last one the join needs) and of the run itself (it may have parked after
its children had already ended). The cron heartbeat sweeps the same handler,
which is what resolves a plain `duration` / `deadline` and backstops a missed
event. Callers can race, so `resumeWait` takes the run with a guarded write
(`updateIfPaused`) and exactly one of them resumes it.

Two traps that cost real debugging time:

- A `condition` sees child progress only through the reserved `children` root
  — `children.allFinished`, `children.totalCount`, `children.completedCount`,
  `children.failedCount` — which `resumeWait` fills by querying the run's
  children on `parentInstanceId` each time it is checked. `allFinished` means every child
  has *stopped* (completed or failed), and is true when nothing was spawned. A
  child never writes into its parent, so `variables.*` never reflects child
  state. The wait still needs its `duration` or `deadline`: when the timer wins,
  the run resumes with whatever children finished.
- `collect` is how the parent reads the children's results after the join:
  `{ children: [{ instanceId, definitionName, status, error, output }], count,
  completedCount, failedCount }`, where `output` is the child's
  `variables[config.step]` (all of its `variables` when no `step` is set, and
  `null` when that step never ran). It reads the children on demand — a
  finishing child still writes nothing into its parent — and lists failed and
  unfinished children too, so the next step decides what a partial result means.
- `run-workflow` is the one-child shorthand. It runs the `spawn` handler for a
  single target and returns the `__wait` sentinel with `child.instanceId` on
  it, so `resumeWait` resolves the step with exactly that child's
  `collect`-shaped entry — when the child completes or fails, or at `timeout`
  with its current status. A parked step's execution stays `paused` until the
  auto-runner, picking the resumed run back up, closes it with the output; that
  is what makes a loop returning to the step dispatch a new child rather than
  reuse the last one's result.
- Step ids inside a `condition` must use underscores. The expression parser
  reads `spawn-perspectives` as subtraction.
