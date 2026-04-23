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

_Pending commit 3 — supply-intelligence, protocol-to-tfl, community-digest, workflow-designer._

## Concepts

_Pending commit 4 — autonomy-levels, plugin-dispatch, repository-pattern, docker-spawn-strategies, dual-schema-migration, expression-evaluator, service-singleton._

_Pending commit 5 (pharma domain) — cdisc-sdtm, ctcae-grading, recist-v1-1, pharma-domain-context._

## Decisions

_Pending._

## Gotchas

_Pending commit 6 — mediforce-source-custom-condition, remote-e2e-setup, dual-schema-routing._

## Syntheses

_Pending — answers filed back from chats._
