---
status: living
audience: workflow-authors
last_reviewed: 2026-08-19
---

# How to verify a workflow

Four checks answer four different questions. Work up the ladder — each rung
assumes the ones below it passed.

| # | Check | Answers | Costs |
|---|-------|---------|-------|
| 1 | Schema validation | Is the definition legal? | Nothing — no execution |
| 2 | Workflow readiness check | Are the image, secrets, model and credits it needs present? | Nothing — no execution |
| 3 | Dry Run | Is the workflow structured as I intended? | A real Run with agent/script work mocked — **action steps still fire** |
| 4 | Run | Does the work produce what I wanted? | The real thing — containers, model calls, credits |

## 1. Schema validation — *is the definition legal?*

Checks required fields, step shapes, transition targets and expression syntax
against the canonical schema. Executes nothing, and says nothing about whether
the things the definition points at exist.

Runs automatically every time you save a version in the workflow editor — a
definition that fails cannot be saved. From the CLI:

```bash
# server-side, against the platform's schema
pnpm exec mediforce workflow validate path/to/workflow.wd.json

# local only (no API call), with a namespace applied; also warns about images
# missing from your local Docker daemon
pnpm exec mediforce workflow register \
  --file path/to/workflow.wd.json \
  --namespace docs \
  --dry-run
```

> `register --dry-run` is **schema validation**, not a Dry Run. It executes
> nothing. The Dry Run in rung 3 is a real Run.

## 2. Workflow readiness check — *are its dependencies present?*

Reads the saved definition against the state of your workspace and reports what
is missing, each with a fix action:

- **Missing Docker image** — a step names an image the platform cannot find and
  has no `repo` + `commit` build source. See
  [docker-image-setup.md](docker-image-setup.md).
- **Missing secret** — a step's `env` references `{{SECRET_NAME}}` that neither
  the workflow nor the workspace defines.
- **Low credits** — workspace model credits are spent or nearly spent, and the
  workflow has agent steps.
- **Unknown model** — an agent step names a model absent from the registry (a
  near match is suggested when there is one).

**This check lives in the web app, not the platform.** It runs when you start a
run from the UI and its findings appear in the start-run dialog; workspace-wide
findings are also listed on the workflow list page.

`mediforce run start` and `POST /api/runs` **skip it** — they validate the
definition and the trigger payload, then fire. A run started from the CLI or the
API with a missing image or an unset secret is accepted and fails later, in the
step that needs the missing thing. To clear this rung for a workflow you drive
from the CLI, open it in the app once and read the dialog.

## 3. Dry Run — *is it structured as I intended?*

A **real Run** with `dryRun` set, in which every `agent` and `script` step is
swapped for the mock plugin. The graph, transitions, verdict gates and human
steps all execute for real; only the expensive agent and script work is faked —
so its output is mock output and tells you nothing about agent quality.

> **A Dry Run is not a sandbox.** `action` steps run exactly as they would in a
> real Run: an `email` action sends the email, an `http` action issues the
> request against the real endpoint. Point those at a test recipient or a
> staging endpoint before you dry-run a workflow you did not write. (`spawn` is
> the one action that knows about dry runs — child workflows inherit the
> parent's dry-run mode.)

Start one with the **Dry Run** button in the start-run dialog (or **Save & Dry
Run** in the editor), or from the CLI:

```bash
pnpm exec mediforce run start --workflow my-workflow --namespace docs --dry-run
```

Use it to answer:

- Does the run reach the steps I expect, in the order I expect?
- Do the transitions and verdict gates route the way I drew them?
- Do human steps present the right form and assign to the right people?
- Does the run terminate, rather than looping or dead-ending?

Dry Runs are a first-class filter on the run listing, so you can find them later.

## 4. Run — *does the work produce what I wanted?*

The real execution: containers pulled and started, model calls made, credits
spent, output files written. Only this rung answers behaviour — whether the
prompt is good, the script parses the file correctly, the report is right.

Start it with **Start Run**, or:

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
