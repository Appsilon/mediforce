# Mediforce Knowledge Base — Schema

Concrete instantiation of the abstract [LLM Wiki pattern](./LLM-WIKI.md) (Karpathy). Pairs with [`STYLE.md`](./STYLE.md) (caveman) + the `/knowledge-base` skill (`skills/knowledge-base/SKILL.md` — operations: ingest, query, file, lint). Read all three before touching the wiki.

## Layout

```
docs/knowledge-base/
  LLM-WIKI.md   # abstract pattern (Karpathy, verbatim, immutable)
  SCHEMA.md     # this file — what/where/how for our repo
  STYLE.md      # caveman writing rules
  wiki/
    index.md    # catalog; read first on every query
    log.md      # append-only (bootstrap / ingest / file-back / lint)
    entities/   # packages, plugins, apps, workflows
    concepts/   # patterns, architectural ideas, domain standards
    decisions/  # ADR-style, write-once
    gotchas/    # footguns, non-obvious invariants, "already exists" traps
    syntheses/  # filed-back answers from chats
```

Wiki ops write only inside `wiki/`. Everything else = raw source.

## Raw sources (immutable during wiki ops)

| Source | Where |
|--------|-------|
| Project docs | `docs/*.md`, `docs/design/`, `docs/features/` |
| Agents contract | `AGENTS.md`, `CLAUDE.md` |
| Package READMEs | `packages/*/README.md`, `apps/*/README.md` |
| Source code | `packages/*/src/`, `apps/*/` |
| Workflow defs | `**/*.wd.json` |
| Zod schemas | `packages/platform-core/src/schemas/` |
| Git history | commits, PR descriptions |
| External refs | pharma standards (CDISC, ICH-GCP, RECIST), tool docs |

Every wiki page cites its sources. No page without citations.

## Page buckets

| Bucket | Filename | Holds |
|--------|----------|-------|
| `entities/` | `<category>/<slug>.md` (e.g. `packages/platform-ui.md`) | concrete named things: packages, plugins, apps, workflows |
| `concepts/` | `<slug>.md` | architectural patterns + domain standards (CDISC, CTCAE, RECIST, autonomy-levels, plugin-dispatch, …) |
| `decisions/` | `YYYY-MM-DD-<slug>.md` | ADR-style, write-once |
| `gotchas/` | `<slug>.md` | footguns, "already exists" traps, non-obvious invariants |
| `syntheses/` | `YYYY-MM-DD-<slug>.md` | file-back answers from chats |

Section shape: look at existing pages in each bucket — agents learn from examples, not from rules. If a page doesn't fit any bucket, propose a new one in `log.md` before filing.

## Frontmatter

Every page starts with:

```yaml
---
type: entity | concept | decision | gotcha | synthesis
created: YYYY-MM-DD
updated: YYYY-MM-DD
sources: <count of raw sources referenced>
tags: [workflow-engine, plugin-system]
---
```

Then: one-sentence **bold summary** (used verbatim in `index.md`). Then sections. Last section always `## Sources` listing raw paths / commit SHAs / URLs.

## Conventions

- English only (matches `AGENTS.md`).
- Cross-refs: relative markdown (`[pkg](../entities/packages/workflow-engine.md)`). No wikilinks — GitHub doesn't render them.
- Relative `.md` links stay inside `wiki/`; cite anything outside (e.g. `AGENTS.md`) in plain text.
- Filenames: lowercase kebab-case.
- No emojis.
- Contradictions with new sources: don't silently overwrite. Add a `> [!note]` callout + flag in `log.md`.
- ADR-style prose goes in `decisions/`, not in entity pages — entities link to decisions.

## Pharma domain

Clinical terms (CTCAE grade, RECIST, CDISC vars, AE codes, drug names) = identifiers. No wellbeing framing. Full rule: `AGENTS.md` → "Pharma Domain Context". Runtime carrier: `WorkflowDefinition.preamble` → `buildPrompt()` in `BaseContainerAgentPlugin`.

## Workflows

Ingest, query, file-back, lint — all documented in `skills/knowledge-base/SKILL.md`. Append a `log.md` entry per op:

```
## [YYYY-MM-DD] <op> | <title>
touched: <pages>
summary: <one line>
```

## Scale

Current: ~40 pages. `index.md` + grep are enough. At ~100 pages revisit: per-category sub-indexes, maybe [qmd](https://github.com/tobi/qmd) for BM25+vector search.
