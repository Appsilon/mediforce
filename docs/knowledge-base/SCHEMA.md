# Mediforce Knowledge Base — Schema

This is the Mediforce-specific instantiation of the [LLM Wiki pattern](./LLM-WIKI.md). It tells agents **where the raw sources live**, **what pages to write**, **what conventions to follow**, and **when to run ingest/query/lint**. Agents are expected to consult this schema before touching the wiki.

The abstract pattern is in `LLM-WIKI.md` (Karpathy). This file is the concrete contract for this repo.

## Layout

```
docs/knowledge-base/
  LLM-WIKI.md          # abstract pattern (immutable — Karpathy verbatim)
  SCHEMA.md            # this file — conventions for our repo
  wiki/                # LLM-maintained wiki (agent owns this directory)
    index.md           # catalog of every wiki page, grouped by category
    log.md             # append-only chronological log (ingest/query/lint)
    entities/          # one page per package, agent, plugin, workflow def
    concepts/          # architectural patterns, domain concepts (CDISC, RECIST, autonomy)
    decisions/         # ADR-style decision records
    gotchas/           # non-obvious invariants, footguns, workarounds
    syntheses/         # answers filed back from chat (comparisons, analyses)
```

Agents MUST NOT write anywhere outside `docs/knowledge-base/wiki/` as part of a wiki operation. Other repo files are **raw sources** and are immutable from the wiki's perspective.

## Raw sources (immutable)

What agents ingest from, but never modify during wiki ops:

| Source | Where | Notes |
|--------|-------|-------|
| Project docs | `docs/*.md`, `docs/design/`, `docs/features/` | architecture, vision, E2E strategy |
| Agents contract | `AGENTS.md`, `CLAUDE.md` | repo-level instructions |
| Package READMEs | `packages/*/README.md`, `apps/*/README.md` | per-package docs |
| Source code | `packages/*/src/`, `apps/*/` | read for entity pages; do not summarise line-by-line |
| Workflow definitions | `**/*.wd.json` | plugin + step config |
| Schemas | `packages/platform-core/src/schemas/` | Zod schemas — authoritative domain model |
| Git history | `git log`, commit messages | decisions, rationale |
| Pull requests | GitHub `appsilon/mediforce` | discussion, review context |
| External refs | pharma standards (CDISC SDTM/ADaM, ICH-GCP, RECIST), tool docs | link by URL; snapshot key quotes |

Agent ingest rule: **cite the source path or URL on every wiki page.** No page without citations.

## Page types

Each wiki page lives in one of these buckets. If a page doesn't fit, propose a new bucket in the log before adding it.

### `entities/`
One page per concrete named thing in the repo. Filename = slug of the entity.

- `entities/packages/platform-core.md`, `entities/packages/workflow-engine.md`, …
- `entities/plugins/claude-code-agent.md`, `entities/plugins/script-container.md`, …
- `entities/workflows/<workflow-id>.md`
- `entities/apps/supply-intelligence.md`

Required sections: Purpose · Dependencies · Key exports / surface · Relationships (links to other entities/concepts) · Sources.

### `concepts/`
Architectural patterns and domain ideas. Filename = concept slug.

- `concepts/repository-pattern.md`
- `concepts/plugin-dispatch.md`
- `concepts/autonomy-levels.md` (L0–L4)
- `concepts/dual-schema-migration.md`
- `concepts/cdisc-sdtm.md`, `concepts/ctcae-grading.md`, `concepts/recist-v1-1.md`

Required sections: Definition (one paragraph) · How it shows up in the codebase · Links to entities that use it · Sources.

### `decisions/`
ADR-style records. Filename: `YYYY-MM-DD-slug.md`.

Required sections: Context · Decision · Consequences · Alternatives considered · Sources (PRs, commits, discussions).

### `gotchas/`
Non-obvious things that have burned us. Filename: `<slug>.md`.

Required sections: Symptom · Cause · Fix / workaround · How to avoid next time · Sources.

### `syntheses/`
Answers filed back from conversations — comparisons, deep-dives, investigations. Filename: `YYYY-MM-DD-slug.md`.

Required sections: Question · Answer · Sources (including the chat context that triggered it, if useful).

## Conventions

- **Language**: English only (matches `AGENTS.md`).
- **Frontmatter**: every wiki page starts with YAML frontmatter:
  ```yaml
  ---
  type: entity | concept | decision | gotcha | synthesis
  created: 2026-04-23
  updated: 2026-04-23
  sources: 3      # count of raw sources referenced
  tags: [workflow-engine, plugin-system]
  ---
  ```
- **Top line**: after frontmatter, one-sentence summary in bold. The index pulls this verbatim.
- **Cross-references**: use relative markdown links (`[workflow-engine](../entities/packages/workflow-engine.md)`). No wikilinks — they don't render on GitHub.
- **Sources section**: every page ends with `## Sources` listing raw paths, PR/commit SHAs, and external URLs. No hand-waving; if a claim has no source, it doesn't belong on the page.
- **Contradictions**: when a new source contradicts an existing page, do not silently overwrite. Add a `> [!note]` callout inline explaining the contradiction and flag it in the log.
- **No inline ADR-style prose in entities**: if a decision matters, link to a `decisions/` page.
- **Filenames**: lowercase kebab-case.
- **No emojis** in wiki content (matches repo-wide convention).

## Pharma domain note

This codebase processes pharmaceutical/clinical-trial data. Terms like "adverse event", "Grade 5", "hepatotoxicity", "mortality endpoint" are **technical domain content** (CDISC variables, CTCAE grading, RECIST criteria). Treat them as code-identifiers. No wellbeing framing — see `AGENTS.md` → "Pharma Domain Context".

## Operations

### Ingest

Trigger: a new raw source appears that's worth compiling (significant doc, new package, merged PR that changes architecture, external article the user shares).

Flow:
1. Read the source end-to-end.
2. Identify which existing wiki pages it touches (read `wiki/index.md`, follow links).
3. For each affected entity/concept page: update inline, preserving existing sources.
4. If the source introduces a new entity/concept/decision/gotcha: create the page.
5. Update `wiki/index.md` (add new entries, bump counts).
6. Append an entry to `wiki/log.md`:
   ```
   ## [YYYY-MM-DD] ingest | <source title or path>
   touched: <list of wiki pages>
   summary: <one line>
   ```
7. Report to the user what changed.

Default is **one source at a time**. Batch ingest only when explicitly requested.

### Query

Trigger: the user asks a "how does X work / what is Y / why did we choose Z" question, OR an agent needs background before starting work.

Flow:
1. Read `wiki/index.md` first.
2. Open the relevant pages and their linked pages.
3. Answer with citations back to wiki pages (and through them, to raw sources).
4. **File-back rule**: if the question took non-trivial synthesis (pulling from 2+ pages, writing a comparison, investigating), file the answer as a `syntheses/` page and link it from the index. Add a log entry.

### Lint

Trigger: before pushing a PR that touched `wiki/` pages, plus a scheduled pass at least once per week.

Checks:
- **Contradictions** between pages (search for the same entity/concept described differently).
- **Stale claims** — a page references code that no longer exists (grep the paths/symbols it cites).
- **Orphans** — pages with no inbound links from other wiki pages or `index.md`.
- **Missing pages** — concepts/entities referenced in text but without their own page.
- **Broken cross-references** — relative links that no longer resolve.
- **Stale frontmatter** — `updated` field older than the last substantive edit.
- **Source rot** — external URLs that return 4xx/5xx (spot-check with curl).

Output: a single markdown report to the user + an entry in `log.md`. Fixes go in the same PR if trivial; otherwise file them as TODOs at the top of `index.md`.

## When agents MUST update the wiki

These are hard triggers, not suggestions:

- **After a non-trivial architectural change** (new plugin, new package, moved boundary between packages, swapped infra layer) → update the corresponding entity page + append log.
- **After discovering a gotcha** (time spent >15 min chasing something non-obvious) → add `gotchas/<slug>.md`.
- **After a decision with lasting impact** (picking a library, picking a pattern, deciding not to do something) → add `decisions/YYYY-MM-DD-slug.md`.
- **After a synthesis answer** the user asked that required pulling from multiple sources → file under `syntheses/`.

## When agents MUST consult the wiki

- **Before answering architecture/"how does X work" questions** — read `wiki/index.md` first.
- **Before starting work in an unfamiliar package** — check its `entities/packages/*.md` page.
- **Before making a decision that smells similar to a past one** — grep `decisions/` for the topic.

If the wiki has nothing on the topic, that's itself a signal: once the work is done, file the resulting knowledge.

## Scale

Current scale is small (bootstrap). At ~100 pages, revisit: may want per-category sub-indexes, and possibly a search tool (e.g. `qmd`). Until then, `index.md` is sufficient.
