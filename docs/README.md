---
status: living
audience: everyone
last_reviewed: 2026-08-18
---

# Mediforce documentation

One read of this file should tell a human where to go and an agent what to
trust. If a doc is not reachable from the table below, it is not documentation
we maintain.

This folder also serves the public website at **mediforce.ai** — `index.html`,
`security.html`, `validated-ai.html`, `fda-principles.html`, `examples.html`,
`nav.js`, `CNAME`, `setup/`, `case-studies/`, `preview/`, `images/`. Those files
back live URLs and never move. GitHub shows this README when you browse the
folder; GitHub Pages serves `index.html` at the URL. Everything else below is
engineering documentation.

## Where do I go?

| I want to… | Start here |
|---|---|
| Get the app running for the first time | [`../GETTING-STARTED.md`](../GETTING-STARTED.md) |
| Look up a command, port, or env var | [`start/dev-quickref.md`](start/dev-quickref.md) |
| Understand what Mediforce is and why | [`concepts/vision.md`](concepts/vision.md) |
| Understand how the packages fit together | [`concepts/architecture.md`](concepts/architecture.md) |
| Build a workflow | [`guides/create-workflow.md`](guides/create-workflow.md) |
| Look up what a workflow *can* do | [`reference/workflow-capabilities.md`](reference/workflow-capabilities.md) |
| Know which rules a production workflow must satisfy | [`reference/workflow-authoring-golden-rules.md`](reference/workflow-authoring-golden-rules.md) |
| Write a test at the right level | [`testing/e2e-strategy.md`](testing/e2e-strategy.md) |
| Know why the code is shaped the way it is | [`adr/README.md`](adr/README.md) |
| Work on this repo with agents | [`contributing/ai-development-process.md`](contributing/ai-development-process.md) |

## Routing table

Every engineering doc, what it is for, and how far to trust it.

| Topic | Path | Audience | Status |
|---|---|---|---|
| Command-first dev reference | [`start/dev-quickref.md`](start/dev-quickref.md) | engineers | living |
| Local Postgres and migrations | [`start/postgres-local-dev.md`](start/postgres-local-dev.md) | engineers | living |
| Running a workspace locally | [`start/running-workspace-locally.md`](start/running-workspace-locally.md) | engineers | living |
| Local dev conventions, auth setup | [`start/development.md`](start/development.md) | engineers | living |
| Product vision and positioning | [`concepts/vision.md`](concepts/vision.md) | everyone | living |
| Package graph, autonomy model | [`concepts/architecture.md`](concepts/architecture.md) | engineers | living |
| How the team operates | [`concepts/how-we-work.md`](concepts/how-we-work.md) | everyone | living |
| Authoring a workflow, end to end | [`guides/create-workflow.md`](guides/create-workflow.md) | workflow authors | living |
| Building and pushing step images | [`guides/docker-image-setup.md`](guides/docker-image-setup.md) | workflow authors | living |
| Importing a workflow from git | [`guides/import-from-git.md`](guides/import-from-git.md) | workflow authors | living |
| The four verification gates | [`guides/verify-a-workflow.md`](guides/verify-a-workflow.md) | workflow authors | living |
| Onboarding a landing zone | [`guides/landing-zone-onboarding.md`](guides/landing-zone-onboarding.md) | operators | living |
| What workflows can do, mapped to source | [`reference/workflow-capabilities.md`](reference/workflow-capabilities.md) | workflow authors | living |
| Production rules a workflow must satisfy | [`reference/workflow-authoring-golden-rules.md`](reference/workflow-authoring-golden-rules.md) | workflow authors | living |
| Handler / contract / repo layering | [`reference/api-architecture.md`](reference/api-architecture.md) | engineers | living |
| Container step execution | [`reference/container-steps.md`](reference/container-steps.md) | engineers | living |
| Carrying values into the next run | [`reference/previous-run.md`](reference/previous-run.md) | engineers | living |
| Tutorial workflow definitions | [`workflow-examples/README.md`](workflow-examples/README.md) | workflow authors | living |
| L1–L5 test-level model | [`testing/e2e-strategy.md`](testing/e2e-strategy.md) | engineers | living |
| Workflow-engine test approach | [`testing/engine-testing.md`](testing/engine-testing.md) | engineers | living |
| Building this repo with agents | [`contributing/ai-development-process.md`](contributing/ai-development-process.md) | everyone | living |
| Architectural decisions | [`adr/README.md`](adr/README.md) | engineers | living |
| Implemented design notes | [`design/`](design/) | engineers | living |
| Deferred explorations | [`research/`](research/) | engineers | draft |
| LLM-maintained wiki | [`knowledge-base/`](knowledge-base/) | agents | living |
| Executed plans, runbooks, completed migrations | [`archive/`](archive/) | engineers | historical |

**`archive/` is not guidance.** It holds the two completed headless-migration
docs, the four executed ADR implementation plans (`PLAN-0001`, `PLAN-0002`,
`PLAN-0003`, `PLAN-0016`) and the staging-cutover runbook. Cite them for
history — including the `PLAN-NNNN §N.N` section numbers that code comments
reference — never as instructions for what to build now. A plan lives in
`adr/` alongside its ADR only while the work is in flight.

## Conventions

### Status header

Every doc starts with frontmatter:

```yaml
---
status: living
audience: engineers
last_reviewed: 2026-08-18
---
```

`status` answers *how far do I trust this?*

- `living` — current, maintained, safe to act on.
- `draft` — a shape being explored. Not decided, not binding.
- `historical` — a record of a past state. Accurate about then, not about now.

ADRs use their own lifecycle in the same field — `proposed`, `accepted`,
`finalized`, `superseded` — defined in [`adr/README.md`](adr/README.md).
`accepted` and `finalized` are binding; `superseded` is historical.

`audience` is one of `everyone`, `engineers`, `workflow authors`, `operators`,
`agents`. `last_reviewed` is the date someone last checked the doc against the
code — not the date it was last edited.

### Naming

Lowercase kebab-case, always. The only exceptions are `README.md` and the
numbered `adr/NNNN-*.md` / `adr/plans/PLAN-NNNN.md` /
`adr/runbooks/RUNBOOK-NNNN-*.md` families, which are cited by number.

### Links

Relative Markdown links. `scripts/check_doc_links.py` runs in CI and fails the
build on a link or backticked `docs/`/`skills/` path that does not resolve;
docs marked `historical` are exempt, because their references point at a repo
that no longer exists.

### Where new docs go

`start/` get running · `concepts/` what Mediforce is · `guides/` how do I X ·
`reference/` lookup surfaces · `testing/` test strategy · `contributing/` how we
build with agents · `adr/` decisions and their in-flight plans · `design/`
rationale behind shipped behaviour · `research/` deferred · `archive/` finished.

A doc moves to `archive/` when the work it describes is done — that is what
keeps `status: living` meaningful for everything else.

Two directories are addressed from outside the repo and must not move:
`workflow-examples/` is the default git-import source
(`github.com/Appsilon/mediforce/tree/main/docs/workflow-examples`), and the
website files listed at the top back live `mediforce.ai` URLs.
