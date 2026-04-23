# Wiki Index

Catalog of every page in the Mediforce knowledge base. Agents update this on every ingest. Read this first when answering a query.

Conventions and workflow: see [`../SCHEMA.md`](../SCHEMA.md). Abstract pattern: see [`../LLM-WIKI.md`](../LLM-WIKI.md).

## TODO (pending work flagged by lint)

_Empty — wiki bootstrap. Add TODOs here during lint passes (missing pages, broken links, source rot)._

## Entities

### Packages

- [platform-core](./entities/packages/platform-core.md) — foundational Zod schemas, repository interfaces, test factories; zero internal deps.
- [platform-infra](./entities/packages/platform-infra.md) — Firestore repositories, Firebase auth, notifications, secrets cipher.
- [workflow-engine](./entities/packages/workflow-engine.md) — process instance orchestrator, transition routing, triggers, expression evaluator.
- [agent-runtime](./entities/packages/agent-runtime.md) — agent execution engine, plugin dispatch, Docker spawn strategies, fallback handling.
- [platform-ui](./entities/packages/platform-ui.md) — Next.js 15 web app, API routes, `getPlatformServices()` composition root.
- [supply-intelligence](./entities/packages/supply-intelligence.md) — pure supply-chain domain (SKU, warehouse, batch, FEFO allocation, risk classification).
- [supply-intelligence-plugins](./entities/packages/supply-intelligence-plugins.md) — LLM narratives + Firestore draft-issue writes wrapping supply-intelligence.

### Plugins

- [claude-code-agent](./entities/plugins/claude-code-agent.md) — default container plugin running Claude Code; MOCK_AGENT swaps for fixtures.
- [opencode-agent](./entities/plugins/opencode-agent.md) — container plugin running OpenCode; local Ollama + cloud providers.
- [script-container](./entities/plugins/script-container.md) — deterministic scripted container (no LLM); used by community-digest.
- [example-agent](./entities/plugins/example-agent.md) — reference AgentPlugin template; 50-line event-emission pattern.
- [supply-intelligence/driver-agent](./entities/plugins/supply-intelligence-driver-agent.md) — narrative risk summaries (SKU, category, overview).
- [supply-intelligence/risk-detection](./entities/plugins/supply-intelligence-risk-detection.md) — red-flag scanner, writes draft issues to Firestore.

### Workflows

_Pending — ingest `**/*.wd.json` files._

### Apps

- [supply-intelligence](./entities/apps/supply-intelligence.md) — standalone Next.js dashboard (port 9004); consumes `supply-intelligence` domain.
- [protocol-to-tfl](./entities/apps/protocol-to-tfl.md) — protocol PDF → TFL pipeline, 6 steps, 5 runtime skills, git-mode commits to `mediforce-clinical-workspace`.
- [community-digest](./entities/apps/community-digest.md) — cron-triggered GitHub→Discord digest; uses `script-container` plugin.
- [workflow-designer](./entities/apps/workflow-designer.md) — meta-workflow that designs new WorkflowDefinitions via AI + human review.

## Concepts

### Architectural

- [autonomy-levels](./concepts/autonomy-levels.md) — L0–L4 scale enforced by `AgentRunner`, coupled with confidence thresholds.
- [plugin-dispatch](./concepts/plugin-dispatch.md) — `AgentRunner` + `PluginRegistry` + `AgentOutputEnvelope`; how steps route to plugins.
- [repository-pattern](./concepts/repository-pattern.md) — interfaces in platform-core, Firestore in platform-infra, in-memory doubles for tests.
- [docker-spawn-strategies](./concepts/docker-spawn-strategies.md) — local child-process vs BullMQ-queued; toggled by REDIS_URL.
- [dual-schema-migration](./concepts/dual-schema-migration.md) — legacy `processDefinitions`+`processConfigs` coexist with unified `workflowDefinitions`; go through `resolveDefinitionSteps()`.
- [expression-evaluator](./concepts/expression-evaluator.md) — custom DSL for transition `when` clauses.
- [service-singleton](./concepts/service-singleton.md) — `getPlatformServices()` composition root in platform-ui.
- [mcp-resolution](./concepts/mcp-resolution.md) — per-step MCP config; workflow-mode (recommended) vs legacy flattened path.
- [llm-no-computation-rule](./concepts/llm-no-computation-rule.md) — LLMs generate prose, numbers come from pure functions.

### Pharma domain

- [pharma-domain-context](./concepts/pharma-domain-context.md) — clinical terms = identifiers; no wellbeing framing; preamble carries framing to runtime.
- [cdisc-sdtm](./concepts/cdisc-sdtm.md) — SDTM → ADaM → TFL pipeline; variable-name standard; ties into protocol-to-tfl.
- [ctcae-grading](./concepts/ctcae-grading.md) — 1–5 AE severity; Grade 5 = death; companion signals (irAE, Hy's Law).
- [recist-v1-1](./concepts/recist-v1-1.md) — CR/PR/SD/PD tumour-response; ORR/DCR/PFS/DoR endpoints; iRECIST variant.
- [ich-gcp](./concepts/ich-gcp.md) — regulatory framework; ALCOA+ data integrity; audit events = regulatory requirement.

## Decisions

_Pending._

## Gotchas

_Pending commit 6 — mediforce-source-custom-condition, remote-e2e-setup, dual-schema-routing._

## Syntheses

_Pending — answers filed back from chats._
