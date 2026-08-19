---
status: living
audience: everyone
last_reviewed: 2026-08-19
---

# Mediforce documentation

One read of this file should tell a human where to go and an agent what to
trust. A doc not reachable from the table below is not documentation we
maintain — the link checker fails the build on one.

New here: [`../GETTING-STARTED.md`](../GETTING-STARTED.md), then
[`start/dev-quickref.md`](start/dev-quickref.md).

> This folder also serves the public website at **mediforce.ai**: the `.html`
> files and `nav.js` at this level, plus `CNAME`, `setup/`, `case-studies/`,
> `preview/`, `images/`, `features/` and the loose images. Those back live URLs
> and never move. GitHub Pages serves `index.html`; GitHub renders this README
> when you browse the folder. Everything below is engineering documentation.

## Routing table

Every engineering doc, what it is for, and how far to trust it.

| I want to… | Doc | Audience | Status |
|---|---|---|---|
| Get the app running the first time | [`../GETTING-STARTED.md`](../GETTING-STARTED.md) | everyone | living |
| Look up a command, port, or env var | [`start/dev-quickref.md`](start/dev-quickref.md) | engineers | living |
| Follow local dev conventions and auth setup | [`start/development.md`](start/development.md) | engineers | living |
| Run Postgres and migrations locally | [`start/postgres-local-dev.md`](start/postgres-local-dev.md) | engineers | living |
| Run a workspace locally | [`start/running-workspace-locally.md`](start/running-workspace-locally.md) | engineers | living |
| Understand what Mediforce is and why | [`concepts/vision.md`](concepts/vision.md) | everyone | living |
| Use the canonical domain vocabulary | [`../CONTEXT.md`](../CONTEXT.md) | everyone | living |
| See how the packages fit together | [`concepts/architecture.md`](concepts/architecture.md) | engineers | living |
| Know how the team operates | [`concepts/how-we-work.md`](concepts/how-we-work.md) | everyone | living |
| Build a workflow, end to end | [`guides/create-workflow.md`](guides/create-workflow.md) | workflow-authors | living |
| Build and push step images | [`guides/docker-image-setup.md`](guides/docker-image-setup.md) | workflow-authors | living |
| Import a workflow from git | [`guides/import-from-git.md`](guides/import-from-git.md) | workflow-authors | living |
| Pass the four verification gates | [`guides/verify-a-workflow.md`](guides/verify-a-workflow.md) | workflow-authors | living |
| Onboard a landing zone | [`guides/landing-zone-onboarding.md`](guides/landing-zone-onboarding.md) | operators | living |
| Look up what a workflow *can* do | [`reference/workflow-capabilities.md`](reference/workflow-capabilities.md) | workflow-authors | living |
| Know the rules a production workflow must satisfy | [`reference/workflow-authoring-golden-rules.md`](reference/workflow-authoring-golden-rules.md) | workflow-authors | living |
| Add a handler, contract, or repository | [`reference/api-architecture.md`](reference/api-architecture.md) | engineers | living |
| Understand container step execution | [`reference/container-steps.md`](reference/container-steps.md) | engineers | living |
| Carry values into the next run | [`reference/previous-run.md`](reference/previous-run.md) | engineers | living |
| Copy a working workflow definition | [`workflow-examples/README.md`](workflow-examples/README.md) | workflow-authors | living |
| Write a test at the right level | [`testing/e2e-strategy.md`](testing/e2e-strategy.md) | engineers | living |
| Test the workflow engine | [`testing/engine-testing.md`](testing/engine-testing.md) | engineers | living |
| Work on this repo with agents | [`contributing/ai-development-process.md`](contributing/ai-development-process.md) | everyone | living |
| Write a doc an agent will read | [`contributing/doc-style.md`](contributing/doc-style.md) | agents | living |
| Know why the code is shaped the way it is | [`adr/README.md`](adr/README.md) | engineers | living |
| Read the cowork streaming exploration | [`research/cowork-streaming.md`](research/cowork-streaming.md) | engineers | draft |
| Read the Layer 2 score exploration | [`research/layer2-scores-research.md`](research/layer2-scores-research.md) | engineers | draft |
| Cite finished work | [`archive/`](archive/) | engineers | historical |

**`archive/` is not guidance.** Executed ADR implementation plans
(`PLAN-NNNN`), the staging-cutover runbook, the completed headless-migration
docs, and the retired [knowledge base](archive/knowledge-base/README.md). Cite
them for history — including the `PLAN-NNNN §N.N` sections that code comments
reference — never as instructions for what to build now. The link checker skips
the whole directory, because its references point at a repo that no longer
exists.

## Conventions

### Status header

Every doc **under `docs/`** starts with frontmatter. Colocated `packages/*/` and
`apps/*/` READMEs do not: they are a directory's front door on GitHub, and their
freshness comes from sitting next to the thing they describe rather than from a
review date.

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
- `historical` — accurate about a past state, not about now.

ADRs use their own lifecycle in the same field — `accepted` and `finalized`
bind, partial supersession names the sections it replaces, full supersession
and deprecation are historical — defined in [`adr/README.md`](adr/README.md).

`audience` is one of `everyone`, `engineers`, `workflow-authors`, `operators`,
`agents`. `last_reviewed` is when someone last checked the doc against the code,
not when it was last edited.

### Naming

Lowercase kebab-case, always. The only exceptions are `README.md` and the
numbered `adr/NNNN-*.md`, `PLAN-NNNN.md` and `RUNBOOK-NNNN-*.md` families, which
are cited by number.

### Links

Relative Markdown links. `pnpm check:docs`
([`check_doc_links.py`](../scripts/check_doc_links.py)) fails on a link or
backticked `docs/`/`skills/` path that does not resolve, on invalid or missing
frontmatter, and on an active doc missing from the table above. It checks
structure, never whether prose is *true* — that is `AGENTS.md` rule 11 and
`/sync-docs`.

It runs in both workflows, because a link breaks from both sides: docs-only PRs
skip [`ci.yml`](../.github/workflows/ci.yml) entirely, and a code-only PR that
renames or deletes a link target matches no `**.md` filter in
[`docs.yml`](../.github/workflows/docs.yml).

### Where new docs go

**A package or app documents itself.** Every directory under `packages/` and
`apps/` carries its own `README.md`, and that file is the authority on what the
package is for, what depends on it, and what you must not do to it. It ships in
the same PR as the package — `pnpm check:readmes`
([`check_readme_coverage.py`](../scripts/check_readme_coverage.py)) fails the
build otherwise, and runs in `ci.yml` only — a new package containing no
Markdown file matches no `**.md` path filter, so `docs.yml` never fires on it.

This is geometry, not filing preference: `git rm -r packages/foo` carries off
`packages/foo/README.md` with the code; it cannot carry off a page three
directories away. That asymmetry is why the retired knowledge base filled up
with entries describing deleted code
([ADR-0017](adr/0017-retire-llm-maintained-wiki.md)). Colocation does not
prevent edit drift — `/sync-docs` checks changed names and claims against
source. Keep READMEs short and aimed at what the code does not say.

`docs/` covers only what spans more than one package:

`start/` get running · `concepts/` what Mediforce is · `guides/` how do I X ·
`reference/` lookup surfaces · `testing/` test strategy · `contributing/` how we
build with agents · `adr/` decisions and their in-flight plans · `research/`
deferred explorations · `archive/` finished.

A doc moves to `archive/` when the work it describes is done — that is what
keeps `status: living` meaningful for everything else.

Two directories are addressed from outside the repo and must not move:
`workflow-examples/` is the default git-import source
(`github.com/Appsilon/mediforce/tree/main/docs/workflow-examples`), and the
website files noted at the top.
