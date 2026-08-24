---
title: Building workflows
sidebar_label: Building workflows
sidebar_position: 3
---

# Building workflows

A **workflow** is a named, reusable process. It owns many **definitions** —
numbered, immutable versions — and a pointer to the default one. A **run** is one
execution of one definition.

Editing a workflow means creating the next version. Nothing you save changes a
version that already exists, so a run in flight is never altered underneath.

## The canvas

Open a workflow and its definition renders as a graph you edit in place. Each
node is a **step**; the arrows are **transitions**. **Add Block** inserts a step,
and a hover panel on each node deletes or moves it. Undo and redo cover canvas
changes.

The header carries **Save**, **Save & Dry Run** and **Save & Start Run**. All
three open a dialog that asks for a version name — a short note about what
changed, which is what the version list shows later.

## Pasting a definition as JSON

**Workflow source code** opens the definition as JSON, live-updating as you edit
the canvas. It also works the other way: paste a definition in, press **Apply JSON
to canvas**, and the graph becomes yours to edit. This is the fastest way to start
from a definition someone sent you, or to move a workflow between deployments
without a git import.

Applying is gated, so a paste either lands whole or is refused with a reason:

- **Steps and transitions only.** Other authorable fields — title, metadata — are
  page state, not canvas state. A paste that changes them is refused rather than
  quietly dropping them, and points you at workspace settings.
- **Schema first.** Each step and transition is validated, and the first problem
  is named — `steps: ...` or `transitions: ...`.
- **Then the graph.** A transition pointing at a step that does not exist, or a
  step nothing reaches, is reported before anything is applied.

What lands on the canvas is the normalised graph that passed those gates, not the
raw text you pasted: verdict transitions are merged and the entry step is put
first. Applying is one undo step, so a paste you did not mean is reversible.

While the modal holds edits you have not applied, it warns — *"Unapplied changes
— click 'Apply JSON to canvas' to keep them"* — and closing without applying
prompts first.

:::note Applying is not saving
Apply puts the graph on the canvas. It is still unsaved, and still creates a new
version only when you press Save.
:::

## The AI assistant

Beside the canvas is an assistant that edits the workflow with you. Describe what
you want — *"add a step where a medical writer reviews the draft, and send it back
to the agent if they ask for changes"* — and it adds, updates and removes steps on
the canvas.

Its changes land on the canvas as ordinary edits. Nothing is saved until you save,
undo reverses them like any other change, and you are free to adjust everything it
did. When a change leaves the workflow unsaveable, the assistant says so rather
than letting you discover it at save time — *"Heads up — this won't save yet"*,
with the reason.

Pick the model it uses from the settings beside the input. The list is filtered to
models that support tool calling and carry enough context to hold your workflow;
if none qualify, the picker says so and a larger-context model has to be added to
the registry.

The assistant edits the definition. It does not start runs, and it cannot create
triggers — schedules and webhooks live in the Triggers tab.

From the CLI:

```bash
pnpm exec mediforce assistant ask "add a QC review after the draft step" \
  --canvas ./canvas.json --namespace acme
```

## Steps

Every step has a **type** and an **executor**.

The type says what the step contributes to the run:

| Type | What it does |
|---|---|
| `creation` | Produces a result later steps can read. Most steps. |
| `decision` | Produces no result; only picks which branch runs next. |
| `terminal` | Ends the run. |

The executor says who does the work:

| Executor | Use it for |
|---|---|
| `human` | Accountability and approval — someone must look at it |
| `script` | Deterministic work: parsing, validation, conversion, API glue |
| `action` | Built-in side effects, no container needed (see below) |
| `agent` | Judgment an LLM can carry, with or without an approval gate |
| `cowork` | A person and an agent working the same artifact live |

The executor is fixed when the step is created and cannot be changed afterwards —
change it by deleting the step and adding the intended one.

## Actions

An `action` step does one built-in thing, with no container image to build:

| Kind | Does |
|---|---|
| `http` | Calls an endpoint |
| `email` | Sends mail |
| `reshape` | Rewrites earlier results into the shape the next step expects |
| `spawn` | Starts other workflow runs |
| `wait` | Pauses until a deadline |

:::warning Actions are real in a Dry Run
Only `agent` and `script` steps are mocked. An `email` action **sends the mail**
and an `http` action **hits the endpoint**, Dry Run or not. See
[Gotchas](../gotchas/).
:::

## Agent steps and autonomy

An agent step carries an **autonomy level** that decides how much a person stays
in the loop, from an agent that only drafts for approval to one that proceeds on
its own. `L3` is the built-in approve/revise loop: the agent produces work, a
person approves or asks for a revision, and a revision sends it back to the
agent.

`L3` revision keys off the literal `approve` and `revise` verdicts. Custom
verdict keys belong on a separate human review step.

## Branches and verdicts

A step that can go more than one way declares **verdicts** — the named outcomes a
person or agent picks between — and a transition per verdict. A verdict may point
back to an earlier step, which is how revision loops are drawn.

Human review steps must define their verdicts explicitly; `requiresComment` makes
the reviewer say why.

## Secrets

A workflow that needs a credential reads it from a **secret**, set per workspace
or per workflow and encrypted at rest. Steps reference the name; the value is
never in the definition, so a definition stays safe to export and import.

```bash
pnpm exec mediforce secret set OPENAI_KEY --namespace acme
pnpm exec mediforce secret list --namespace acme
```

The readiness check reports a referenced secret that is not set before you start
a run.

## Container steps

`script` and `agent` steps run in a container image that must already be on the
platform. A missing image fails the run at its first step, and the readiness
check warns about it beforehand.

## Saving

Saving validates the definition's schema and the graph — a step nothing
transitions to, or a transition pointing at a step that does not exist, is
rejected with the reason. A rejected save shows the whole message; nothing is
stored until it passes.

Next: [Running workflows](../run/).
