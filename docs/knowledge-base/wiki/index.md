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

_Pending commit 2 — claude-code-agent, opencode-agent, script-container, example-agent, supply-intelligence plugins._

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
