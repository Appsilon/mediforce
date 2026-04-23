---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 3
tags: [plugin, supply-intelligence, narrative, llm]
---

**Narrative risk summarizer — generates prose for SKU+warehouse pairs, therapeutic categories, and portfolio overview. Registered as `supply-intelligence/driver-agent`.**

## Purpose

Given pre-computed risk numbers (from [`supply-intelligence`](../packages/supply-intelligence.md) + `lib/risk-computations.ts`), produces a narrative summary via LLM. Numbers are templated into the prompt; the LLM is never asked to compute them. Keeps outputs auditable — you can trace any claim in the narrative back to a number.

## Inputs

Decided by prompt target:
- SKU-level (specific SKU × warehouse)
- Category-level (therapeutic category rollup)
- Overview (portfolio-wide)

Prompt builders live in `packages/supply-intelligence-plugins/src/prompts/`.

## How it fits

- Registered via `registerSupplyIntelligencePlugins(registry)` called from [`platform-ui`](../packages/platform-ui.md) `getPlatformServices()`.
- Data fetched through `lib/supply-data-fetcher.ts` (Firestore).

## Relationships

- Sibling: [`supply-intelligence/risk-detection`](./supply-intelligence-risk-detection.md).
- Depends on: [`supply-intelligence`](../packages/supply-intelligence.md), [`agent-runtime`](../packages/agent-runtime.md).

## Sources

- `packages/supply-intelligence-plugins/src/driver-agent-plugin.ts`
- `packages/supply-intelligence-plugins/src/prompts/` (4 builders)
- `packages/supply-intelligence-plugins/src/lib/risk-computations.ts`
