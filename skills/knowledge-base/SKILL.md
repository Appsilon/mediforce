---
name: knowledge-base
description: Ingest sources into the LLM-maintained wiki, query it, and lint it. Use when adding new docs, answering architecture/domain questions, filing a synthesis answer back, or before pushing a PR that touched wiki pages.
allowed-tools: Bash, Read, Edit, Write, Glob, Grep
metadata:
  version: "1.0"
  domain: development
  complexity: basic
  tags: knowledge-base, wiki, documentation, karpathy-llm-wiki
---

# Knowledge Base

Maintains `docs/knowledge-base/wiki/` following the [LLM Wiki pattern](../../docs/knowledge-base/LLM-WIKI.md) under [Mediforce schema conventions](../../docs/knowledge-base/SCHEMA.md).

**Always read `docs/knowledge-base/SCHEMA.md` before acting.** It defines raw-source locations, page types, frontmatter, filenames, and the rules below.

## Usage

```
/knowledge-base ingest <path-or-url>      # compile a new source into the wiki
/knowledge-base query <question>          # answer from the wiki, file back if non-trivial
/knowledge-base file <topic>              # file current-conversation synthesis back as a page
/knowledge-base lint                      # health check the wiki
```

## Ingest

1. Read the source end-to-end.
2. Read `docs/knowledge-base/wiki/index.md` to identify existing pages this source touches.
3. For each affected page: update inline. Preserve existing citations; add new ones.
4. If the source introduces a new entity / concept / decision / gotcha: create the page under the right bucket (`entities/`, `concepts/`, `decisions/`, `gotchas/`). Match the section shape of existing pages in that bucket — examples beat rules. Filename patterns + frontmatter per `SCHEMA.md`.
5. Update `wiki/index.md` (new entries, bump counts, remove stale TODOs).
6. Append a log entry:
   ```
   ## [YYYY-MM-DD] ingest | <source title or path>
   touched: <comma-separated page paths>
   summary: <one line>
   ```
7. Report to the user: new pages, updated pages, contradictions flagged.

Default: **one source at a time.** Only batch when explicitly asked.

## Query

1. `cat docs/knowledge-base/wiki/index.md` first.
2. Read relevant pages + their linked pages.
3. Answer with citations to wiki paths (which themselves cite raw sources).
4. If the answer required pulling from 2+ pages or writing a comparison/analysis: **file it back** as a `syntheses/YYYY-MM-DD-<slug>.md`, update the index, append a `file-back` log entry.

## File

Use when the user explicitly says "file this" or the current conversation produced a non-trivial synthesis worth keeping. Same flow as the file-back step of `query`.

## Lint

Run `bash skills/knowledge-base/scripts/lint.sh` if the helper exists; otherwise do the checks manually:

- **Contradictions** — grep key entity/concept names across wiki pages; flag divergent descriptions.
- **Stale claims** — for each `file:line` or symbol citation, verify it still exists (`git ls-files`, `grep -r`).
- **Orphans** — pages not linked from `index.md` or any other page.
- **Missing pages** — concepts/entities mentioned in text without their own page.
- **Broken cross-references** — every relative `.md` link must resolve.
- **Stale frontmatter** — `updated` older than the last substantive edit to the page (`git log -1 --format=%cs <page>`).
- **Source rot** — external URLs; `curl -s -o /dev/null -w "%{http_code}"` each one.

Output: single markdown report + log entry. Trivial fixes go in the same PR; otherwise add to `index.md` → TODO section.

## Triggers (from `AGENTS.md`)

Agents MUST update the wiki after:
- A non-trivial architectural change → update entity page.
- Discovering a gotcha (>15 min chasing something non-obvious) → add `gotchas/`.
- A lasting decision (library pick, pattern change, "we chose not to") → add `decisions/`.
- A synthesis answer pulled from multiple sources → add `syntheses/`.

Agents MUST consult the wiki before:
- Answering architecture / "how does X work" questions.
- Starting work in an unfamiliar package.
- Making a decision that echoes a previous one.

## Do not

- Do not write wiki pages without citations to raw sources.
- Do not modify raw sources (`docs/*.md` except under `docs/knowledge-base/wiki/`, code, `AGENTS.md`) as part of a wiki op.
- Do not overwrite contradictory claims silently — flag them with a callout and note in the log.
- Do not use wikilinks (`[[…]]`); use relative markdown links.
- Do not add emojis.
