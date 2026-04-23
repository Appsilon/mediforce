---
type: concept
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [concept, service-singleton, platform-ui, composition-root]
---

**`getPlatformServices()` in `platform-ui/src/lib/platform-services.ts` is the single composition root — it lazily wires every repository, the workflow engine, agent runner, and plugin registry. Shared across API routes and server components.**

## Why it matters

Every API route that touches persistence or agents goes through this function. If you're about to instantiate a `FirestoreProcessRepository`, a `WorkflowEngine`, or an `AgentRunner` inside a handler, **stop** — call `getPlatformServices()` instead. That's the only way to reuse the lazy singletons and keep plugin registration consistent.

## What it builds

- Every Firestore repository (via [`platform-infra`](../entities/packages/platform-infra.md)).
- `WorkflowEngine` + `StepExecutor` (via [`workflow-engine`](../entities/packages/workflow-engine.md)).
- `AgentRunner` + `PluginRegistry` (via [`agent-runtime`](../entities/packages/agent-runtime.md)).
- Firebase Auth + User Directory services.
- The built-in plugins: `claude-code-agent`, `opencode-agent`, `script-container` (or their mocks when `MOCK_AGENT=true`).
- [`supply-intelligence-plugins`](../entities/packages/supply-intelligence-plugins.md) via `registerSupplyIntelligencePlugins(registry)`.

## Fail-fast

Validates required encryption keys (`secrets-cipher`) on first call. Missing or misconfigured keys throw immediately rather than failing on first workflow execution.

## Lifecycle

Lazy-initialised on first call. Subsequent calls return the same instance. Next.js route handlers + RSC + API routes all share it within a single server process.

## Sources

- `packages/platform-ui/src/lib/platform-services.ts`
- `AGENTS.md` → "Key architectural patterns" → "Service singleton"
