---
status: historical
audience: engineers
last_reviewed: 2026-08-18
---

# Knowledge base — retired 2026-08-18

An LLM-maintained wiki following Karpathy's [LLM Wiki pattern](./LLM-WIKI.md),
bootstrapped 2026-04-23 and retired four months later. Kept as a record of what
was tried and why it did not hold. **Nothing here is guidance.** Several pages
describe packages, apps, and symbols that no longer exist.

## Why it was retired

**The compounding never started.** The pattern's distinguishing operation is
file-back: capture a synthesis so it accumulates instead of vanishing into chat
history. Over four months it ran once, on 2026-07-27. It touched exactly one
file — `wiki/log.md` — and its own summary records that the real updates landed
in ADR-0011, `workflow-capabilities`, `previous-run`, and an app README. The
wiki logged that it had nothing to do.

**Two of five declared buckets were never created.** `SCHEMA.md` declares
`entities/ concepts/ decisions/ gotchas/ syntheses/`. Only three ever existed.
`decisions/` went unused because `docs/adr/` already does that job;
`syntheses/` went unused because file-back never produced a page. The two
missing buckets are the two carrying the pattern's value.

**Drift had a structural cause, not a discipline cause.** Pages keyed on a repo
path or symbol died; pages keyed on an external standard or a terminal symptom
survived. Every dead page documented *deleted* code — five `supply-intelligence`
pages, `resolveDefinitionSteps()`, the dual-schema migration. Deletions never
propagate: nothing in a `git rm -r packages/foo` diff points at a wiki page
three directories away. Additions were noticed, because you are already editing
nearby — 14 commits from feature PRs touched `wiki/` after bootstrap.

That last point is the one worth carrying forward. Documentation about a thing
belongs next to the thing, where `git rm` takes it along.

## Where the surviving content went

| Content | Now at |
|---|---|
| Caveman writing rules (`STYLE.md`) | [`../../contributing/doc-style.md`](../../contributing/doc-style.md) |
| `mediforce-source`, `skillsDir`, remote-E2E gotchas | [`../../start/dev-quickref.md`](../../start/dev-quickref.md) — Troubleshooting and Gotchas |
| `in-memory-repos-not-mocks` | already covered by [`../../testing/engine-testing.md`](../../testing/engine-testing.md) |
| Package / app / plugin entity pages | ported to colocated `README.md`s and **deleted from this archive**, so there is no second copy to disagree |
| CDISC, CTCAE, RECIST, ICH-GCP concept pages | not carried forward — see below |

Thirteen entity pages were verified against the code, ported, and removed
(2026-08-18). The five `supply-intelligence` pages were not: they describe code
that has been deleted, so there was nothing to port them to. They remain here as
the clearest illustration of the drift described above.

The four pharma-standard pages (`wiki/concepts/cdisc-sdtm.md`,
`ctcae-grading.md`, `recist-v1-1.md`, `ich-gcp.md`) are the only content here
with no drift at all: they describe external regulatory standards, so no
refactor can invalidate them. They stayed behind because nothing currently
reads them. Promote them into `docs/reference/` if a workflow needs them.

## Decision record

ADR-0017.
