# @mediforce/workflow-engine

Runs the workflow loop: execute a step, resolve which transition fires, track
review verdicts, evaluate `when:` expressions, fire triggers.

**The engine is stateless.** It holds no instance state between calls — every
fact it needs arrives as an argument, and every fact it produces goes back to a
repository. That is what makes a run resumable after a process restart and what
lets the same engine drive an HTTP request, a cron tick, and a test.

## What lives here

| Directory | Holds |
|---|---|
| `src/engine/` | `WorkflowEngine` (advance/pause/resume/abort), `StepExecutor`, `transition-resolver.ts`, `complete-human-task.ts`, typed errors |
| `src/expressions/` | The `when:` DSL evaluator — `${variables.field} == "value"` |
| `src/review/` | `ReviewTracker` — verdict accumulation against review constraints |
| `src/triggers/` | `ManualTrigger`, `CronTrigger`, `WebhookRouter`, cron schedule utilities |

## Rules

**Graph validation lives in `platform-core`, not here.** `validateStepGraph` and
`validateWorkflowGraphAndReferences` are re-exported from this package so the
public surface is unchanged, but they are defined in `platform-core` so a
workflow can be validated at design time without taking a dependency on the
engine. Do not reintroduce a local copy.

**Transitions fan out; they do not short-circuit.** `resolveTransitions`
evaluates *every* outgoing `when:` and returns all that match — two matching
transitions mean two branches, not a priority contest. `when: 'else'` fires only
when nothing else matched. Writing overlapping conditions and expecting the
first to win produces a silent extra branch.

**No matching transition is an error**, never a quiet halt —
`NoMatchingTransitionError`. A workflow that can reach a state with nowhere to
go is a bug in the definition, and the engine's job is to say so loudly.

**Errors are typed and meaningful.** `StepFailureError`, `RoutingError`,
`InvalidTransitionError`, `MaxIterationsExceededError` — route on the type.
`MaxIterationsExceededError` in particular is the loop guard; raising the cap to
make a workflow pass is treating the symptom.

## Testing

`src/**/__tests__/` runs the engine against `platform-core`'s in-memory
repositories — no database, no containers, so the full transition matrix is
cheap to exercise. Approach and conventions:
[`docs/testing/engine-testing.md`](../../docs/testing/engine-testing.md).
