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

## `spawn` and `wait`

Fan-out is one child *workflow* per item, not one step repeated N times — the
rejected alternatives and the parent→child linkage are in
[ADR-0018](../../docs/adr/0018-fan-out-is-child-workflows.md).

Handlers are pure functions and cannot pause a run, so `wait` returns a
`__wait` sentinel and the auto-runner — which owns lifecycle transitions —
intercepts it. Resuming is a separate `resumeWait` handler rather than part of
the auto-runner loop, because that loop rejects non-running instances; the cron
heartbeat calls it, so resume granularity is ~15 minutes.

Two traps that cost real debugging time:

- A `condition` sees child progress only through the reserved `children` root
  — `children.allCompleted`, `children.totalCount`, `children.completedCount`,
  `children.failedCount` — which `resumeWait` fills by querying the run's
  children on `parentInstanceId` at each sweep. `allCompleted` means every child
  has *stopped* (completed or failed), and is true when nothing was spawned. A
  child never writes into its parent, so `variables.*` never reflects child
  state. The wait still needs its `duration` or `deadline`: when the timer wins,
  the run resumes with whatever children finished.
- Step ids inside a `condition` must use underscores. The expression parser
  reads `spawn-perspectives` as subtraction.
