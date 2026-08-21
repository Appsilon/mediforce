---
status: accepted
audience: engineers
last_reviewed: 2026-08-18
---

# ADR-0017: Retire the LLM-maintained wiki; documentation lives next to what it describes

**Date:** 2026-08-18

## Context

On 2026-04-23 we bootstrapped `docs/knowledge-base/` — an LLM-maintained wiki
following Karpathy's LLM Wiki pattern. The premise: an agent incrementally
compiles and maintains a persistent, interlinked wiki, so knowledge accumulates
instead of being re-derived on every query. Maintenance cost is near zero
because the agent, not a human, does the bookkeeping.

Four months later, #1220 found the wiki actively misinforming agents: five
pages documenting deleted `supply-intelligence` packages, a `gotchas/` page
instructing readers to route through `resolveDefinitionSteps()` (zero
occurrences in the repo), `platform-infra` described as "Firestore
repositories, Firebase auth" after the Postgres and NextAuth cutovers, and
eight of fourteen apps absent entirely.

Three things the audit established, which the framing of "the wiki went stale"
misses:

**The wiki was not neglected.** Fourteen commits touched `wiki/` after
bootstrap, all from feature PRs — the databricks-job plugin, the SMTP provider,
the triggers removal, the auth cutover. People updated it when they added
things.

**Drift is predicted by what a page points at, not by which bucket it sits in.**
Pages keyed on a repo path or symbol died. Pages keyed on an external standard
(CDISC, ICH-GCP, RECIST, CTCAE) or on a terminal symptom survived untouched.
Every dead page documented *deleted* code. Deletions never propagate: nothing
in a `git rm -r packages/foo` diff points at a wiki page three directories
away, whereas additions get noticed because you are already editing nearby.
This is geometry, not discipline, so no cadence or ownership assignment fixes
it.

**The compounding never started.** File-back — the operation that distinguishes
this pattern from a folder of markdown — ran exactly once in four months, on
2026-07-27. It touched one file, `wiki/log.md`, and its own summary records
that the real updates landed in ADR-0011, `workflow-capabilities`,
`previous-run`, and an app README. Two of the five buckets `SCHEMA.md` declares
were never created: `decisions/` because `docs/adr/` already does that job, and
`syntheses/` because file-back never produced a page. The schema was 60%
aspirational on the day it was written.

## Decision

**Retire the wiki.** `docs/knowledge-base/` moves to
`docs/archive/knowledge-base/` with a retirement note; the `/knowledge-base`
skill, its registry entry and its `.claude/skills/` symlink are deleted.

**Documentation about a thing lives next to the thing.** Where a doc would
describe a package, app, or plugin, it belongs in that directory's `README.md`,
so `git rm` carries it away and an editor sees it in peripheral vision. No
parallel tree mirroring the repo layout.

Content that was in active use moved to where it stays live:

| Content | Now at |
|---|---|
| `STYLE.md` caveman rules, cited by `/code-review` as a standard | `docs/contributing/doc-style.md` |
| `mediforce-source` condition, `skillsDir` coupling, remote-E2E prep | `docs/start/dev-quickref.md` — Troubleshooting + Gotchas |
| `in-memory-repos-not-mocks` | dropped; `docs/testing/engine-testing.md` already covers it |

`docs/archive/` is now exempt from `scripts/check_doc_links.py` by path rather
than per-file frontmatter, so future archived material needs no annotation.

## Consequences

**Positive.** One documentation system instead of two — a single index
(`docs/README.md`), a single frontmatter convention
(`status`/`audience`/`last_reviewed`), no second catalog to disagree with the
first. Deletion-drift becomes structurally impossible for colocated docs. Six
pieces of scaffolding (`LLM-WIKI.md`, `SCHEMA.md`, `STYLE.md`, `index.md`,
`log.md`, a skill) stop being maintained for content that was mostly a snapshot
of `src/index.ts`.

**Negative.** Package-level orientation regresses before it improves: eleven of
twelve packages and nine of fourteen apps have no README, and
`docs/concepts/architecture.md` carries no package graph, so until those
READMEs are written the only orientation is the `<stack>` block in `AGENTS.md`.
That work is deliberately not folded into #1220 — it is a new deliverable, not
a mechanical move, and is tracked separately.

> **Resolved since.** Every `packages/*/` and `apps/*/` directory now carries a
> `README.md` (enforced by `pnpm check:readmes`), and
> [`concepts/architecture.md`](../concepts/architecture.md) carries the package
> graph. The regression recorded above is closed.

Colocation fixes deletion-drift, not edit-drift: a `README.md` can still
describe a renamed export. It is milder, because the README sits in the diff's
own directory, and `/sync-docs` is the lever if it proves insufficient.

The four pharma-standard pages (CDISC SDTM, CTCAE, RECIST v1.1, ICH-GCP) are
the only content with no drift risk at all, and they stay in `archive/` because
nothing currently reads them. Promote them into `docs/reference/` when a
workflow needs them.

We lose the ability to answer "what changed in the wiki?" as a compounding
record — but the log shows that record was never built.

## Alternatives considered

**Keep and re-ingest on a cadence** (#1220 option a). Preserves the compounding
premise, and is what the pattern asks for. Rejected: it assigns a standing cost
to a mechanism whose distinguishing operation ran once in four months, and it
does not address deletion-drift, which no cadence catches.

**Narrow to `gotchas/` plus the pharma concepts** (#1220 option b, the issue's
recommendation). Rejected on evidence: three of five gotchas were already stale
— `dual-schema-routing` dead outright, `in-memory-repos-not-mocks` still
warning against mocking Firestore — and `llm-no-computation-rule`'s every
example and source path pointed at deleted code. `gotchas/` is not the
drift-proof bucket the option assumes, and naming *folders* as the criterion is
what allowed the rot in the first place.

**Absorb `docs/` into the wiki**, making it the single store. Rejected: it
inverts the direction the evidence supports. The wiki's machinery is the part
that was abandoned within a day of bootstrap; ordinary markdown is what
survived four months of real use.
