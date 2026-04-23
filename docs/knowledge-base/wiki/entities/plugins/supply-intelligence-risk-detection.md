---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 3
tags: [plugin, supply-intelligence, issues, firestore]
---

**Scans red-flagged SKU+warehouse pairs, computes priority scores, and writes draft issues to Firestore. Registered as `supply-intelligence/risk-detection`.**

## Purpose

Surfaces actionable supply-chain risks. Pulls supply data, runs `classifyRisk()` from [`supply-intelligence`](../packages/supply-intelligence.md), filters to red rows, ranks them with `lib/priority-score.ts`, and produces draft issues — each with an LLM-generated title, summary, and proposed action — written to Firestore collection `draftIssues`.

## Output

Firestore writes in collection `draftIssues`. The LLM contributes text only; priority score and thresholds are deterministic.

## How it fits

- Registered via `registerSupplyIntelligencePlugins(registry)` from [`platform-ui`](../packages/platform-ui.md).
- Shares data-fetching and risk-computation libs with the [driver-agent plugin](./supply-intelligence-driver-agent.md).

## Relationships

- Sibling: [`supply-intelligence/driver-agent`](./supply-intelligence-driver-agent.md).
- Depends on: [`supply-intelligence`](../packages/supply-intelligence.md), [`agent-runtime`](../packages/agent-runtime.md), `firebase-admin`.

## Sources

- `packages/supply-intelligence-plugins/src/risk-detection-plugin.ts`
- `packages/supply-intelligence-plugins/src/lib/priority-score.ts`
- `packages/supply-intelligence-plugins/src/lib/issue-writer.ts`
