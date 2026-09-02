---
status: living
audience: workflow-authors
last_reviewed: 2026-09-02
---

# How to create a workflow

This guide covers the *process* of authoring a workflow — which path to use, how
to import from git, and how to validate before sharing. For the rules a finished
workflow MUST satisfy, see
[workflow-authoring-golden-rules.md](../reference/workflow-authoring-golden-rules.md).

## Pick an authoring path

The product states this same fork: **Ways to author**, in the Workflow Designer
toolbar, names each path with a reason to pick it and the first move it takes —
including the clone and the `/design-workflow` invocation, which are useless as
a name alone. It is the summary of the sections below, worded in
[`authoring-paths.ts`](../../packages/platform-ui/src/lib/authoring-paths.ts);
change one, change the other. Its footer opens this file on GitHub
(`CREATE_WORKFLOW_URL` in
[`docs-links.ts`](../../packages/platform-core/src/utils/docs-links.ts)) rather
than naming a path only a reader with a checkout could follow — so moving or
renaming this file breaks that link.

### AI Assistant (in the canvas)

The Workflow Designer canvas has a built-in **AI Assistant** pane — describe the
workflow in plain language and it edits the canvas for you, as an alternative to
placing and wiring blocks by hand.

- **When to use it.** Reach for it to scaffold a first draft or make a bulk edit
  ("add a finance-approval decision before the report step"); keep using the
  block picker + step editor for precise, one-field tweaks.
- **Requirement.** It needs an `OPENROUTER_API_KEY` **workspace secret** — the
  assistant calls a model via OpenRouter. Without it the pane reports the missing
  key. Pick the model in the pane's settings (only tool-capable, sufficiently
  large-context models are offered).
- **What it can change.** Steps only: it adds, updates, and removes steps (and
  their transitions/verdicts) on the canvas. It does not edit triggers, secrets,
  or other workspace state — set those yourself (triggers are attached after
  registration; see below).
- **Validation & retry.** Every proposed change is validated against the same
  graph, reference, and schema gates as registration before it is applied; if the
  result would be invalid the assistant is told why and retries, so it does not
  hand you a workflow that cannot be saved.
- **You still save.** The assistant edits the *unsaved* canvas. Nothing is
  persisted until you **Save** (or **Save & Start Run** / **Save & Dry Run**) —
  review the diagram, then save a version like any other edit.

### Agent — the `/design-workflow` skill

Run the [`design-workflow`](../../skills/design-workflow/SKILL.md) skill. It is the
agent form of Workflow Designer: same intelligence, driven against the
checked-out source instead of a live UI. Invoke it with `/design-workflow` (or
just ask an agent to "design a workflow" / "author a workflow"), then follow the
interview.

What the skill does for you:

1. **Loads the authority first.** It reads the capability map, `CONTEXT.md`
   glossary, the golden rules, and the `docs/workflow-examples/` files before
   proposing structure — so it authors from the source of truth, not from
   memory.
2. **Picks a mode.** `create-new` from an idea, or `edit-existing` when you
   point it at a folder that already contains a `src/*.wd.json` (it recaps the
   current workflow before touching it).
3. **Interviews and challenges.** One question at a time, it steers the design
   toward the golden standards — pushing back when a step should be a `script`
   or `action` rather than an `agent`, when the whole thing needs no workflow at
   all, and when substantial script code should move from inline to a pinned
   command. It ends with a written spec recap you confirm before any files are
   generated.
4. **Generates the package.** The `.wd.json` plus `README.md`, `workflows-index.json`,
   and
   only the `Dockerfile` / `scripts/` / `skills/` / `setup/` the design actually
   needs, in the canonical repo layout. It is honest about three tiers:
   schema-validated (`.wd.json`), templated-but-not-runtime-verified (infra),
   and MANUAL platform setup (Tool Catalog, Agent Definitions, secrets).
5. **Validates against this checkout.** Runs the `register --dry-run` schema
   check, verifies the Dockerfile build context, syntax-checks every generated
   script, and runs a behavior test per non-trivial script (persisting tests
   under `tests/`).
6. **Pins runtime sources and hands off.** Fills each `commit` with an all-zeros
   sentinel until you commit once and give it the real SHA, which it edits in —
   then reports the files written, the MANUAL setup left, and the register /
   import / UI commands filled in with your values.

The skill does **not** run `git commit` / `push` for you and never targets
production — you own the commit and the SHA.

### By hand — blocks on the canvas

**Workflows → New Workflow** opens the Workflow Designer canvas on a starter
template. Add blocks with **Add Block** (or the **+** on an edge to insert
between two steps), choose the step type and executor in the picker, and set the
block's fields in the step editor; **Workflow source code** shows the same
unsaved workflow as `.wd.json`. Reach for it when you want precise control over
one block. Which executor a block should be is decided in
[golden rules §5](../reference/workflow-authoring-golden-rules.md#5-choose-control-mode-executor-type).
Nothing is persisted until you **Save** (or **Save & Dry Run** / **Save & Start
Run**).

For an agent step, expand **Prompt & model** and choose a saved agent from the
**Agent ID** dropdown. The list contains the agents visible in the current
workspace; create or configure agents from the workspace's **Agents** page.

The step then runs on that agent's foundation model. Set **agent.model** only
to override it for this one step — leaving it blank keeps the step on whatever
model the agent is configured with, so changing the agent changes every step
that inherits from it.

### By hand — the package files

Write the `.wd.json` and its package yourself only when building a reusable
workflow package, maintaining built-in apps, or adding package assets that
Workflow Designer cannot create yet. Follow the package layout, pinning, and
validation rules in the golden rules.

## Learn the schema from examples

The tutorial examples live in
[`docs/workflow-examples`](../workflow-examples/README.md) — one concept per file
(review loops, script variants, action steps, triggers, validation gates,
anti-patterns). They are deliberately small and are **not** production packages.
For an end-to-end production-style package, read
[`apps/golden-standard-workflow`](../../apps/golden-standard-workflow).

## Define the input contract

Declare the workflow's complete external input under `triggerInput` in the
`.wd.json`. It is a strict, trigger-agnostic contract: manual forms, webhook
bodies, cron payloads, and spawned child runs all validate against it. Steps read
validated values as `${triggerPayload.<field>}` regardless of how the Run was
started.

For webhooks, the JSON body's top-level keys must be the declared field names;
undeclared, missing, or mistyped fields are rejected with `400`. Use an
`object`-typed field when a third-party body is opaque, and nest that body under
the field name. An empty or absent `triggerInput` accepts only an empty payload.

Transport metadata is separate: webhook method, path, query, and non-sensitive
headers, plus cron schedule and `firedAt`, are available as
`${triggerContext.*}`. Credential headers are never copied into the Run.

## Attach triggers (not part of the definition)

Definitions are **trigger-free** — do not declare a `triggers` array in the
`.wd.json`. Manual hand-start works by default: a per-workflow `manual` trigger
is auto-seeded when you register. To add a schedule or webhook, attach a trigger
out-of-band after registering with `mediforce workflow trigger-add` (or the UI
**Triggers** tab); manage them with `trigger-list` / `trigger-update` /
`trigger-start` / `trigger-stop` / `trigger-remove`. See
[ADR-0011](../adr/0011-triggers-detached-unified-resource.md).

Cron triggers can carry a different static input per row. Supply it as a JSON
object whose keys satisfy `triggerInput`; the server validates it when the row
is added or updated and skips a due tick if a later workflow version makes the
stored payload invalid:

```bash
pnpm exec mediforce workflow trigger-add my-workflow \
  --trigger hourly-eu \
  --type cron \
  --schedule '0 * * * *' \
  --payload '{"region":"eu"}' \
  --namespace docs

pnpm exec mediforce workflow trigger-update my-workflow \
  --trigger hourly-eu \
  --payload '{"region":"us"}' \
  --namespace docs
```

## Import from git

Import is a **one-time copy**, not a live link, and currently supports public
GitHub repos only. Re-import to create a new version. The recorded
`source: { url, path, commit }` is provenance only — it does not drive runtime
cloning, Docker builds, skills, or sync.

Full reference, including the `workflows-index.json` manifest and CLI flags:
[`import-from-git.md`](import-from-git.md).

## Verify before sharing

Four checks answer four different questions — schema validation, the workflow
readiness check, a Dry Run, and a Run. Which one you want depends on what you
are asking; only a real Run answers "is the output any good?". The full ladder,
and how to reach each rung, is in
[`verify-a-workflow.md`](verify-a-workflow.md).

Start with schema validation — it exits non-zero and lists structured errors
when the definition is invalid:

```bash
pnpm exec mediforce workflow validate path/to/workflow.wd.json
```

`pnpm exec mediforce workflow schema` prints the schema the validator uses.
To schema-check registration against a specific namespace without writing a
version:

```bash
pnpm exec mediforce workflow register \
  --file path/to/workflow.wd.json \
  --namespace docs \
  --dry-run
```

That flag is schema validation and executes nothing — it is **not** a Dry Run.
A Dry Run is a real Run with agent and script steps mocked
(`run start --dry-run`, or the **Dry Run** button in the UI). Only those two step
kinds are mocked: `action` steps still send the email and issue the HTTP request
for real.

Then walk the production-ready checklist at the bottom of
[workflow-authoring-golden-rules.md](../reference/workflow-authoring-golden-rules.md).
