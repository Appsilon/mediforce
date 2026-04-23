# Wiki Log

Append-only chronological record. Newest entries at the bottom. Every ingest / query-file-back / lint pass must add an entry.

Format: `## [YYYY-MM-DD] <op> | <title>` where `<op>` ∈ `{bootstrap, ingest, file-back, lint}`. See [`../SCHEMA.md`](../SCHEMA.md).

Quick tail: `grep "^## \[" docs/knowledge-base/wiki/log.md | tail -10`

---

## [2026-04-23] bootstrap | Knowledge base scaffolding

Added `docs/knowledge-base/` with:
- `LLM-WIKI.md` (Karpathy idea file, verbatim)
- `SCHEMA.md` (Mediforce-specific conventions)
- `wiki/index.md` + `wiki/log.md`

Wired into `AGENTS.md` → Knowledge Base section + Skills Router. Skill `knowledge-base` added at `skills/knowledge-base/SKILL.md`.

Wiki is empty of content pages. Next ingests should prioritise: package entities (platform-core, workflow-engine, agent-runtime, platform-ui, platform-infra), the autonomy-levels concept, and the plugin-dispatch concept — these are referenced heavily in `AGENTS.md` and most questions route through them.
