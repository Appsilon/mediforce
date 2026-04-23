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

## [2026-04-23] ingest | Package entities (7)

Sourced from parallel Explore surveys of `packages/` + `AGENTS.md` → "Package dependency graph". Filed:
- `entities/packages/platform-core.md`
- `entities/packages/platform-infra.md`
- `entities/packages/workflow-engine.md`
- `entities/packages/agent-runtime.md`
- `entities/packages/platform-ui.md`
- `entities/packages/supply-intelligence.md`
- `entities/packages/supply-intelligence-plugins.md`

Forward-linked to concept pages (plugin-dispatch, autonomy-levels, repository-pattern, docker-spawn-strategies, dual-schema-migration, expression-evaluator, service-singleton) and gotchas (mediforce-source-custom-condition) that are queued for later commits — those links are currently broken and will be flagged by lint until commits 4–6 land.

touched: `index.md`, 7 new entity pages.
summary: covered every `packages/*` directory; `platform-ui` is top of the dependency graph, `platform-core` and `supply-intelligence` are leaves.
