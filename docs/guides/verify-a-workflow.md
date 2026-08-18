---
status: living
audience: workflow-authors
last_reviewed: 2026-08-18
---

# How to verify a workflow

Mediforce has four checks, and they answer four different questions. Picking the
right one is the whole skill — a green schema validation says nothing about
whether the workflow does useful work, and a Run that produces the wrong output
may be a perfectly legal definition.

Work up the ladder. Each rung assumes the ones below it passed.

| # | Check | Answers | Costs |
|---|-------|---------|-------|
| 1 | Schema validation | Is the definition legal? | Nothing — no execution |
| 2 | Workflow readiness check | Are the image, secrets, model and credits it needs present? | Nothing — no execution |
| 3 | Dry Run | Is the workflow structured as I intended? | A real Run with agent/script work mocked — **action steps still fire** |
| 4 | Run | Does the work produce what I wanted? | The real thing — containers, model calls, credits |

## 1. Schema validation — *is the definition legal?*

Checks the definition against the canonical schema: required fields, step
shapes, transition targets, expression syntax. Executes nothing.

Runs automatically every time you save a version in the workflow editor — a
definition that fails schema validation cannot be saved. From the CLI:

```bash
pnpm exec mediforce workflow validate path/to/workflow.wd.json
```

To check registration against a specific namespace without writing a version:

```bash
pnpm exec mediforce workflow register \
  --file path/to/workflow.wd.json \
  --namespace docs \
  --dry-run
```

> `register --dry-run` is **schema validation**, not a Dry Run. It executes
> nothing. The Dry Run in rung 3 is a real Run.

A green result means the platform will accept the definition. It says nothing
about whether the things the definition points at exist.

## 2. Workflow readiness check — *are its dependencies present?*

Inspects the saved definition against the state of your workspace and reports
what is missing, each with a fix action:

- **Missing Docker image** — a step names an image the platform cannot find, and
  no `repo` + `commit` build source is configured. See
  [docker-image-setup.md](docker-image-setup.md).
- **Missing secret** — a step's `env` references `{{SECRET_NAME}}` and neither
  the workflow nor the workspace has that key.
- **Low credits** — the workspace's model credits are spent or nearly spent, and
  the workflow has agent steps.
- **Unknown model** — an agent step names a model that is not in the registry
  (a suggestion is offered when there is a near match).

**This check lives in the web app, not in the platform.** It runs when you start
a run from the UI, and its findings appear in the "Before you start" dialog.
Workspace-wide findings are also listed on the workflow list page.

`mediforce run start` and the `POST /api/runs` endpoint **skip it** — they
validate the definition and the trigger payload, then fire. A run started from
the CLI or the API with a missing image or an unset secret is accepted and fails
later, in the step that needs the missing thing. To clear rung 2 for a workflow
you drive from the CLI, open it in the app once and read the dialog.

Readiness executes nothing — it reads the definition and your workspace. It is
not a substitute for a Dry Run: everything can be present and the graph still be
wired wrong.

## 3. Dry Run — *is it structured as I intended?*

A **real Run** with `dryRun` set, in which every `agent` and `script` step is
swapped for the mock plugin. The graph, transitions, verdict gates, and human
steps all execute for real; only the expensive agent and script work is faked.

> **A Dry Run is not a sandbox.** Only agent and script steps are mocked.
> `action` steps run exactly as they would in a real Run: an `email` action
> sends the email, an `http` action issues the request against the real
> endpoint. A workflow that mails an investigator or POSTs to a production API
> will do so on every Dry Run. Point those actions at a test recipient or a
> staging endpoint before you dry-run a workflow you did not write. (`spawn`
> is the one action that knows about dry runs — child workflows inherit the
> parent's dry-run mode.)

Start one with the **Dry Run** button next to Start run (or **Save & Dry Run**
in the editor), or from the CLI:

```bash
pnpm exec mediforce run start --workflow my-workflow --namespace docs --dry-run
```

Use it to answer:

- Does the run reach the steps I expect, in the order I expect?
- Do the transitions and verdict gates route the way I drew them?
- Do human steps present the right form and assign to the right people?
- Does the run terminate, rather than looping or dead-ending?

Dry Runs are a first-class filter on the run listing, so you can find them
later. A Dry Run **cannot** tell you whether an agent does what you want — its
output is mock output — and it does **not** protect external systems from the
workflow's action steps.

## 4. Run — *does the work produce what I wanted?*

The real execution: containers pulled and started, model calls made, credits
spent, output files written. Only this rung answers behaviour — whether the
prompt is good, the script parses the file correctly, the report is right.

Start it with **Start run**, or:

```bash
pnpm exec mediforce run start --workflow my-workflow --namespace docs
```

## Which one do I want?

- *"Will the platform accept this file?"* → rung 1.
- *"Why did my run fail immediately with a missing image / secret?"* → rung 2.
- *"I rewired the graph and want to know it routes correctly."* → rung 3.
- *"Is the output any good?"* → rung 4. Nothing below it can tell you.

## Related

- [How to create a workflow](create-workflow.md)
- [Workflow authoring rules](../reference/workflow-authoring-golden-rules.md)
- [Getting a Docker image onto the platform](docker-image-setup.md)
