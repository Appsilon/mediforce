---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 3
tags: [plugin, supply-intelligence, narrative, llm]
---

**Narrative risk summarizer. Prose for SKU+warehouse, category, portfolio overview. Registered as `supply-intelligence/driver-agent`.**

## What it does

Takes pre-computed risk numbers (from [`supply-intelligence`](../packages/supply-intelligence.md) + `lib/risk-computations.ts`) → templates into prompt → LLM writes prose. LLM never computes numbers → [llm-no-computation-rule](../../concepts/llm-no-computation-rule.md). Every narrative claim traces to a number.

## Targets

Per prompt target:

- SKU-level (specific SKU × warehouse)
- Category-level (therapeutic rollup)
- Overview (portfolio-wide)

Prompt builders: `packages/supply-intelligence-plugins/src/prompts/`.

## How it fits

- Registered via `registerSupplyIntelligencePlugins(registry)` from [platform-ui](../packages/platform-ui.md) `getPlatformServices()`.
- Data: `lib/supply-data-fetcher.ts` (Firestore).

## Relationships

- Sibling: [`supply-intelligence/risk-detection`](./supply-intelligence-risk-detection.md).
- Depends on: [`supply-intelligence`](../packages/supply-intelligence.md), [`agent-runtime`](../packages/agent-runtime.md).

## Sources

- `packages/supply-intelligence-plugins/src/driver-agent-plugin.ts`
- `packages/supply-intelligence-plugins/src/prompts/` (4 builders)
- `packages/supply-intelligence-plugins/src/lib/risk-computations.ts`
