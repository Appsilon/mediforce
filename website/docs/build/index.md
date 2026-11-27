---
title: Building workflows
sidebar_label: Building workflows
sidebar_position: 3
---

# Building workflows

A **workflow** is a named, reusable process. It owns many **definitions**
(numbered, immutable versions) and a pointer to the default one. A **run** is one
execution of one definition.

Editing a workflow means creating the next version. Nothing you save changes a
version that already exists, so a run in flight is never altered underneath.

## The canvas

Open a workflow and its definition renders as a graph you edit in place. Each
node is a **step**; the arrows are **transitions**. **Add Block** inserts a step,
and a hover panel on each node deletes or moves it. Undo and redo cover canvas
changes.

The header carries **Save**, **Save & Dry Run** and **Save & Start Run**. All
three open a dialog that asks for a version name: a short note about what
changed, which is what the version list shows later.

## Pasting a definition as JSON

**Workflow source code** opens the definition as JSON, live-updating as you edit
the canvas. It also works the other way: paste a definition in, press **Apply JSON
to canvas**, and the graph becomes yours to edit. This is the fastest way to start
from a definition someone sent you, or to move a workflow between deployments
without a git import.

Applying is gated, so a paste either lands whole or is refused with a reason:

- **Steps and transitions only.** Other authorable fields, such as title and metadata, are
  page state, not canvas state. A paste that changes them is refused rather than
  quietly dropping them, and points you at workspace settings.
- **Schema first.** Each step and transition is validated, and the first problem
  is named, as `steps: ...` or `transitions: ...`.
- **Then the graph.** A transition pointing at a step that does not exist, or a
  step nothing reaches, is reported before anything is applied.

What lands on the canvas is the normalised graph that passed those gates, not the
raw text you pasted: verdict transitions are merged and the entry step is put
first. Applying is one undo step, so a paste you did not mean is reversible.

While the modal holds edits you have not applied, it warns with *"Unapplied changes
— click 'Apply JSON to canvas' to keep them"*, and closing without applying
prompts first.

:::note Applying is not saving
Apply puts the graph on the canvas. It is still unsaved, and still creates a new
version only when you press Save.
:::

## The AI assistant

Beside the canvas is an assistant that edits the workflow with you. Describe what
you want, such as *"add a step where a medical writer reviews the draft, and send it back
to the agent if they ask for changes"*, and it adds, updates and removes steps on
the canvas.

Its changes land on the canvas as ordinary edits. Nothing is saved until you save,
undo reverses them like any other change, and you are free to adjust everything it
did. When a change leaves the workflow unsaveable, the assistant says so rather
than letting you discover it at save time: *"Heads up — this won't save yet"*,
with the reason.

Pick the model it uses from the settings beside the input. The list is filtered to
models that support tool calling and carry enough context to hold your workflow;
if none qualify, the picker says so and a larger-context model has to be added to
the registry.

The assistant edits the definition. It does not start runs, and it cannot create
triggers; schedules and webhooks live in the Triggers tab.

From the CLI:

```bash
pnpm exec mediforce assistant ask "add a QC review after the draft step" \
  --definition ./canvas.json --namespace acme
```

## Steps

Every step has a **type** and an **executor**.

The type says what the step contributes to the run:

| Type | What it does |
|---|---|
| `creation` | Produces a result later steps can read. Most steps. |
| `review` | A human business review with explicit verdicts. |
| `decision` | Produces no result; only picks which branch runs next. |
| `terminal` | Ends the run. |

The executor says who does the work:

| Executor | Use it for |
|---|---|
| `human` | Accountability and approval, when someone must look at it |
| `script` | Deterministic work: parsing, validation, conversion, API glue |
| `action` | Built-in side effects, no container needed (see below) |
| `agent` | Judgment an LLM can carry, with or without an approval gate |
| `cowork` | A person and an agent working the same artifact live |

The executor is fixed when the step is created and cannot be changed afterwards:
change it by deleting the step and adding the intended one.

## Actions

An `action` step does one built-in thing, with no container image to build:

| Kind | Does |
|---|---|
| `http` | Calls an endpoint |
| `email` | Sends mail |
| `reshape` | Rewrites earlier results into the shape the next step expects |
| `spawn` | Starts other workflow runs and carries on straight away |
| `wait` | Pauses for a set time, until a deadline, or until a condition holds |
| `collect` | Gathers the results of the runs this run started |
| `run-workflow` | Runs one other workflow and waits for its result |

:::warning Actions are real in a Dry Run
Only `agent` and `script` steps are mocked. An `email` action **sends the mail**
and an `http` action **hits the endpoint**, Dry Run or not. See
[Gotchas](../gotchas/).
:::

## Workflows that call other workflows

Big processes are easier to own as several small workflows. There are two ways to call one from another.

**When you need one answer back**, use `run-workflow`. The step starts the child, waits for it to finish, and hands you its result. In the editor it's the **Run a workflow and use its result** block.

```json
{
  "id": "review_case",
  "type": "creation",
  "executor": "action",
  "action": {
    "kind": "run-workflow",
    "config": {
      "definitionName": "case-review",
      "payload": { "case": "${steps.intake.case}" },
      "timeout": "P14D",
      "step": "decide"
    }
  }
}
```

`timeout` is an ISO 8601 duration such as `P14D` or `PT2H30M`, and it's required, because a parent that could wait forever eventually will. Reaching it moves the parent on with the child's status at that moment; it doesn't cancel the child. `step` picks which of the child's step results you get back; leave it out to get all of them. The output carries the child's `status`, so the next step can branch on whether it succeeded.

**When you need many at once**, use `spawn` with `forEach` to start one run per item, up to 50, then a `wait` whose condition is `children.allFinished == true`, then `collect` to gather what they produced. The wait wakes up the moment the last child ends, and its deadline still applies, so a run that's stuck on one slow reviewer moves on with whatever has finished. `children.totalCount`, `children.completedCount` and `children.failedCount` are there if you need something finer, such as carrying on once most have answered.

`collect` returns every run this run has started, from any step, so filter by `definitionName` if you started more than one kind. [`apps/team-pulse`](https://github.com/Appsilon/mediforce/tree/main/apps/team-pulse) is a working example of the whole pattern.

On the canvas, both kinds of step offer **Show child workflow**, which draws the child's steps underneath so you can read the whole process in one place. A `spawn` with several different targets isn't expandable.

## Agent steps and autonomy

An agent step carries an **autonomy level** that decides how much a person stays
in the loop, from an agent that only drafts for approval to one that proceeds on
its own. `L3` is the built-in approve/revise loop: the agent produces work, a
person approves or asks for a revision, and a revision sends it back to the
agent.

`L3` revision keys off the literal `approve` and `revise` verdicts. Custom
verdict keys belong on a separate human `review` step.

### What an agent has to write

An agent step's result is a file, not its last message. The agent writes one JSON object to `/output/result.json`, ideally including `confidence` (0 to 1) and `confidence_rationale`, and anything else worth keeping, such as reports, tables or figures, alongside it in `/output/`. Those files are committed with the step and show up in the run's output viewer. Anything the agent says at the end of its session is discarded.

A step that ends without a readable `result.json` fails, with a message saying which of the three ways it went wrong: missing, not valid JSON, or not an object. If your prompts or Skills still tell the agent to finish with a particular message, take that instruction out.

When the agent or the step declares an output schema, `result.json` is checked against it. A mismatch gets one automatic attempt at reshaping, and if that doesn't fix it, the run is escalated to a person.

Script steps are more forgiving: `result.json` is optional, and without one, whatever the script printed becomes the result.

## Branches and verdicts

A step that can go more than one way declares **verdicts** (the named outcomes a
person or agent picks between) and a transition per verdict. A verdict may point
back to an earlier step, which is how revision loops are drawn.

Human review steps must define their verdicts explicitly.

The **Task setup** card in the step editor decides what the reviewer fills in. Under **Comment**, tick the verdicts that need a written reason; in the definition that's `"comment": { "requiredForVerdicts": ["revise", "reject"] }`. Without it, sending work back with `revise` needs a comment and other verdicts follow their own `requiresComment`. It's worth requiring one: an agent asked to revise with no feedback has nothing to go on.

Under **Parameters** you can ask the reviewer for structured values as well as a verdict. On an agent step under human review, those values go back to the agent when the reviewer asks for a revision, and are added to the step's result when they approve.

## Passing values between steps

In action payloads, wait deadlines, `stepParams` and human parameter defaults, `${...}` pulls in a value from the run: `${triggerPayload.studyId}`, `${steps.draft.summary}`, `${steps.extract.rows[0].id}`. A string that is nothing but one `${...}` keeps the value's type, so you can pass a whole object or a number; mixed with other text, it becomes text. Secrets are never available this way.

In an agent's or script's `stepParams`, a value with `${...}` in it always wins over what the previous step passed in, while a plain value is only a default. If a reference points at something this run doesn't have, the step fails and names it, rather than running on a blank.

```json
"stepParams": { "pdfPath": "${steps.register_version.pdfPath}", "tone": "formal" }
```

A human step's parameter defaults resolve when the task is created, so the reviewer opens a form already filled in with, say, the draft they're reviewing. If a reference can't be resolved, that field simply starts empty.

```json
"params": [{ "name": "summary", "type": "textarea", "default": "${steps.draft.summary}" }]
```

## Secrets

A workflow that needs a credential reads it from a **secret**, set per workspace
or per workflow and encrypted at rest. Steps reference the name; the value is
never in the definition, so a definition stays safe to export and import.

```bash
printf '%s' "$OPENAI_KEY" | \
  pnpm exec mediforce secret set --key OPENAI_KEY --stdin --namespace acme
pnpm exec mediforce secret list --namespace acme
```

The readiness check reports a referenced secret that is not set before you start
a run.

## Container steps

`script` and `agent` steps run in a container image that must already be on the
platform. A missing image fails the run at its first step, and the readiness
check warns about it beforehand. [Container images](../images/) covers building,
uploading or pulling one and choosing it for a step.

A script step runs with 8 GB of memory and 2 CPUs. If it needs more, ask for it with `script.resources`:

```json
"script": { "runtime": "python", "inlineScript": "...", "resources": { "memory": "16g", "cpus": 4 } }
```

The deployment sets a ceiling with `SCRIPT_MAX_MEMORY` and `SCRIPT_MAX_CPUS` (8g and 2 unless an operator changes them). A request above the ceiling is lowered to it, and the step's log says so, so you'll know why a job ran slower than you asked. Agent steps don't take this setting.

## Saving

Saving validates the definition's schema and the graph. A step nothing
transitions to, or a transition pointing at a step that does not exist, is
rejected with the reason. A rejected save shows the whole message; nothing is
stored until it passes.

Next: [Running workflows](../run/).
