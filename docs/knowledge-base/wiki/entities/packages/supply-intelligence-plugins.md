---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 4
tags: [package, plugins, supply-intelligence]
---

**Agent plugins wrapping pure [`supply-intelligence`](./supply-intelligence.md) with LLM narratives + Firestore draft-issue writes. Registered via `registerSupplyIntelligencePlugins()`.**

## Purpose

Adapter between pure domain + agent runtime. Compute risk rows → template numbers into prompts → LLM writes prose only (never numbers) → Firestore writes for issue drafts. See [llm-no-computation-rule](../../concepts/llm-no-computation-rule.md).

## Dependencies

- Internal: [`agent-runtime`](./agent-runtime.md), [`platform-core`](./platform-core.md), [`supply-intelligence`](./supply-intelligence.md).
- External: `firebase-admin`, `date-fns`.

## Plugins registered

| Name | Class | What |
|------|-------|------|
| `supply-intelligence/driver-agent` | `DriverAgentPlugin` | Narrative risk summaries: SKU+warehouse, category, overview. |
| `supply-intelligence/risk-detection` | `RiskDetectionPlugin` | Scan red-flags → priority score → write drafts to Firestore `draftIssues`. |

Registration: `registerSupplyIntelligencePlugins(registry)` in `src/plugin-registration.ts`. Called from [platform-ui](./platform-ui.md) `getPlatformServices()`.

## Key internal modules

- `src/driver-agent-plugin.ts` — narratives.
- `src/risk-detection-plugin.ts` — issue creation.
- `src/lib/risk-computations.ts` — `RiskRow`, KPIs.
- `src/lib/issue-writer.ts` — Firestore writes.
- `src/lib/priority-score.ts` — severity ranking.
- `src/lib/supply-data-fetcher.ts` — Firebase queries.
- `src/prompts/` — 4 prompt builders (SKU / category / overview / issue).

## Division of labour

Numbers = deterministic functions. Prose = LLM. LLM never computes risk. Auditable: every claim traces to a function call.

## Relationships

- Consumed by: [`platform-ui`](./platform-ui.md) (registered in `getPlatformServices()`).
- Depends on: [`agent-runtime`](./agent-runtime.md), [`platform-core`](./platform-core.md), [`supply-intelligence`](./supply-intelligence.md).

## Sources

- `packages/supply-intelligence-plugins/src/plugin-registration.ts`
- `packages/supply-intelligence-plugins/src/driver-agent-plugin.ts`
- `packages/supply-intelligence-plugins/src/risk-detection-plugin.ts`
- `packages/supply-intelligence-plugins/src/lib/risk-computations.ts`
- `AGENTS.md` → "Plugin system"
