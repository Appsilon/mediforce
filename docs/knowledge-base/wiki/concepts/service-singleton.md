---
type: concept
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [concept, service-singleton, platform-ui, composition-root]
---

**`getPlatformServices()` in `platform-ui/src/lib/platform-services.ts`. Single composition root. Lazy-wires every repo, workflow engine, agent runner, plugin registry. Shared across API routes + server components.**

## Why it matters

Every API route that touches persistence or agents goes through this. About to instantiate `FirestoreProcessRepository`, `WorkflowEngine`, or `AgentRunner` inside a handler? **Stop.** Call `getPlatformServices()` instead. Only way to reuse lazy singletons + keep plugin registration consistent.

## What it builds

- Every Firestore repository (via [`platform-infra`](../entities/packages/platform-infra.md)).
- `WorkflowEngine` + `StepExecutor` (via [`workflow-engine`](../entities/packages/workflow-engine.md)).
- `AgentRunner` + `PluginRegistry` (via [`agent-runtime`](../entities/packages/agent-runtime.md)).
- Firebase Auth + User Directory.
- Built-in plugins: `claude-code-agent`, `opencode-agent`, `script-container` (mocks when `MOCK_AGENT=true`).
- [`supply-intelligence-plugins`](../entities/packages/supply-intelligence-plugins.md) via `registerSupplyIntelligencePlugins(registry)`.

## Fail-fast

Validates encryption keys (`secrets-cipher`) on first call. Missing keys → throw immediately. No deferred failure at workflow runtime.

## Lifecycle

Lazy-init on first call. Subsequent calls reuse. Next.js route handlers + RSC + API routes share it within one server process.

## Sources

- `packages/platform-ui/src/lib/platform-services.ts`
- `AGENTS.md` → "Key architectural patterns" → "Service singleton"
