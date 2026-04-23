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

## [2026-04-23] ingest | Plugin entities (6)

Sourced from Explore survey of plugin registration mechanism + `packages/supply-intelligence-plugins/src/` + `packages/agent-runtime/src/plugins/`. Filed:
- `entities/plugins/claude-code-agent.md`
- `entities/plugins/opencode-agent.md`
- `entities/plugins/script-container.md`
- `entities/plugins/example-agent.md`
- `entities/plugins/supply-intelligence-driver-agent.md`
- `entities/plugins/supply-intelligence-risk-detection.md`

Key fact worth promoting into a concept page: built-in plugins are registered in `platform-ui` `getPlatformServices()` under names `claude-code-agent`, `opencode-agent`, `script-container`; domain plugins register via `registerSupplyIntelligencePlugins(registry)`. Queued for `concepts/plugin-dispatch.md` (commit 4).

touched: `index.md`, 6 new plugin pages.
summary: covered the three built-in container plugins, the reference example-agent, and both supply-intelligence plugins.

## [2026-04-23] ingest | App entities (4)

Sourced from `apps/*/src/*.wd.json` + `apps/*/plugins/*/skills/_registry.yml`. Filed:
- `entities/apps/supply-intelligence.md`
- `entities/apps/protocol-to-tfl.md`
- `entities/apps/community-digest.md`
- `entities/apps/workflow-designer.md`

Key facts noted for downstream concepts:
- Runtime skills (app-specific) resolve via `skillsDir` in `.wd.json`; paths are hardcoded there — this is a potential gotcha worth filing (queued for commit 6: runtime-skill-path-coupling).
- `protocol-to-tfl` uses `git-mode` steps that commit to an external repo — this is a concept (`git-mode-workflows`) worth filing eventually.

touched: `index.md`, 4 new app pages.
summary: covered every `apps/*` directory.

## [2026-04-23] ingest | Architectural concepts (9)

Synthesised from AGENTS.md + the entity pages filed in earlier commits. Filed:
- `concepts/autonomy-levels.md`
- `concepts/plugin-dispatch.md`
- `concepts/repository-pattern.md`
- `concepts/docker-spawn-strategies.md`
- `concepts/dual-schema-migration.md`
- `concepts/expression-evaluator.md`
- `concepts/service-singleton.md`
- `concepts/mcp-resolution.md`
- `concepts/llm-no-computation-rule.md`

Every concept page names the before-you-write-new-code check — e.g. "use `resolveDefinitionSteps()` before hitting Firestore directly", "check `entities/plugins/` before writing a plugin", "numbers come from pure functions, not LLMs". These pages are the primary anti-duplicate-work surface for agents.

touched: `index.md`, 9 new concept pages.
summary: covered the nine architectural concepts referenced most often in AGENTS.md + entity pages. Pharma-domain concepts queued for commit 5.

## [2026-04-23] ingest | Pharma domain concepts (5)

Written in caveman style (user directive mid-commit — see note below). Filed:
- `concepts/pharma-domain-context.md`
- `concepts/cdisc-sdtm.md`
- `concepts/ctcae-grading.md`
- `concepts/recist-v1-1.md`
- `concepts/ich-gcp.md`

Each page: what the standard is, where it shows up in our code (vars, schemas, skills, prompts), canonical external source, related pages.

**Style change from this commit onward**: wiki pages written in caveman style (terse, dropped articles, fragments, tables, imperatives) for context-frugal reads by agents. SCHEMA.md to be updated with the full caveman prompt in a follow-up commit. Earlier pages (commits 1–4) written in fuller prose — lint should eventually rewrite for consistency.

touched: `index.md`, 5 new pharma-concept pages.
summary: covered pharma framing + 4 clinical standards that tie into `protocol-to-tfl` and clinical-workflow schemas.
