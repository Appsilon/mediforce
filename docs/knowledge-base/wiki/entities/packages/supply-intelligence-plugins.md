---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 4
tags: [package, plugins, supply-intelligence]
---

**Agent plugins that wrap the pure `supply-intelligence` domain with LLM narratives and Firestore draft-issue writes. Registered into `PluginRegistry` via `registerSupplyIntelligencePlugins()`.**

## Purpose

Adapter layer between the pure [`supply-intelligence`](./supply-intelligence.md) domain and the agent runtime. Computes risk rows from supply data, templates numbers into prompts, calls an LLM for narrative only (not for calculations), and writes draft issues to Firestore. Two plugins are registered.

## Dependencies

- Internal: [`agent-runtime`](./agent-runtime.md), [`platform-core`](./platform-core.md), [`supply-intelligence`](./supply-intelligence.md)
- External: `firebase-admin`, `date-fns`

## Plugins registered

| Plugin name | Class | Purpose |
|---|---|---|
| `supply-intelligence/driver-agent` | `DriverAgentPlugin` | Narrative risk summaries for SKU+warehouse pairs, therapeutic categories, portfolio overview. |
| `supply-intelligence/risk-detection` | `RiskDetectionPlugin` | Scans red-flagged SKU+warehouse pairs, computes priority scores, creates draft issues in Firestore `draftIssues` collection. |

Registration entry point: `registerSupplyIntelligencePlugins(registry)` in `src/plugin-registration.ts`. Called from [`platform-ui`](./platform-ui.md) `getPlatformServices()`.

## Key internal modules

- `src/driver-agent-plugin.ts` — narrative generation.
- `src/risk-detection-plugin.ts` — issue creation.
- `src/lib/risk-computations.ts` — `RiskRow`, KPI calculations.
- `src/lib/issue-writer.ts` — Firestore draft-issue writes.
- `src/lib/priority-score.ts` — risk severity ranking.
- `src/lib/supply-data-fetcher.ts` — Firebase queries.
- `src/prompts/` — four prompt builders (SKU, category, overview, issue).

## Division of labour

LLMs never compute risk numbers — they only generate prose around pre-computed values. Numbers come from `lib/risk-computations.ts`; prose comes from prompts templated with those numbers. This keeps outputs auditable.

## Relationships

- Consumed by: [`platform-ui`](./platform-ui.md) (registered in `getPlatformServices()`).
- Depends on: [`agent-runtime`](./agent-runtime.md), [`platform-core`](./platform-core.md), [`supply-intelligence`](./supply-intelligence.md).

## Sources

- `packages/supply-intelligence-plugins/src/plugin-registration.ts`
- `packages/supply-intelligence-plugins/src/driver-agent-plugin.ts`
- `packages/supply-intelligence-plugins/src/risk-detection-plugin.ts`
- `packages/supply-intelligence-plugins/src/lib/risk-computations.ts`
- `AGENTS.md` → "Plugin system"
