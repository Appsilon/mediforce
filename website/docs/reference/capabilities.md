---
title: What a workflow can do
sidebar_label: Workflow capabilities
sidebar_position: 9
---

# What a workflow can do

A quick map of the pieces a definition may use.

## Step types

| Type | Produces a result | Purpose |
|---|---|---|
| `creation` | yes | The ordinary step — later steps read what it produced |
| `review` | yes | A human business review carrying its own verdicts |
| `decision` | no | Chooses which branch runs next |
| `terminal` | no | Ends the run |

## Executors

| Executor | Runs in a container | Use for |
|---|---|---|
| `human` | no | Accountability, approval, anything needing a person |
| `script` | yes | Deterministic parsing, validation, conversion, API glue |
| `action` | no | Built-in side effects |
| `agent` | yes | Judgment an LLM can carry |
| `cowork` | yes | A person and an agent on one artifact, live |

## Action kinds

| Kind | Does | Real in a Dry Run |
|---|---|---|
| `http` | Calls an endpoint | **yes** |
| `email` | Sends mail | **yes** |
| `reshape` | Rewrites earlier results into a new shape | yes |
| `spawn` | Starts other workflow runs | children inherit the parent's dry-run mode |
| `wait` | Pauses until a deadline | yes |

## Autonomy levels

Agent steps carry a level from `L0` to `L4`, from a person doing the work with the
agent merely assisting, to the agent proceeding alone. `L3` is the built-in
approve/revise loop, and its revision path keys off the literal `approve` and
`revise` verdicts.

## Rules a production workflow should satisfy

- Every path ends at a `terminal` step. A step nothing transitions to is rejected
  at save.
- Human review steps declare their verdicts explicitly; use `requiresComment`
  when the reason matters.
- Prefer `script` over `agent` for anything deterministic — it is cheaper, faster
  and repeatable.
- Fail fast by default. `continueOnError: true` is for steps whose failure
  genuinely does not matter.
- Reference credentials as secrets, never inline, so a definition stays safe to
  export.
- Use `reshape` to adapt data between steps rather than teaching the next step
  about the previous step's shape.
