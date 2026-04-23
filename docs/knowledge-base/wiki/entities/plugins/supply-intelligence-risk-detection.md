---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 3
tags: [plugin, supply-intelligence, issues, firestore]
---

**Red-flag scanner → priority score → writes draft issues to Firestore `draftIssues`. Registered as `supply-intelligence/risk-detection`.**

## What it does

Pull supply data → `classifyRisk()` from [`supply-intelligence`](../packages/supply-intelligence.md) → filter red rows → rank via `lib/priority-score.ts` → emit draft issues. Each issue: LLM-generated title + summary + proposed action; priority + thresholds are deterministic. See [llm-no-computation-rule](../../concepts/llm-no-computation-rule.md).

## Output

Firestore collection `draftIssues`. LLM contributes text only.

## How it fits

- Registered via `registerSupplyIntelligencePlugins(registry)` from [platform-ui](../packages/platform-ui.md).
- Shares data-fetcher + risk-computations with [driver-agent](./supply-intelligence-driver-agent.md).

## Relationships

- Sibling: [`supply-intelligence/driver-agent`](./supply-intelligence-driver-agent.md).
- Depends on: [`supply-intelligence`](../packages/supply-intelligence.md), [`agent-runtime`](../packages/agent-runtime.md), `firebase-admin`.

## Sources

- `packages/supply-intelligence-plugins/src/risk-detection-plugin.ts`
- `packages/supply-intelligence-plugins/src/lib/priority-score.ts`
- `packages/supply-intelligence-plugins/src/lib/issue-writer.ts`
