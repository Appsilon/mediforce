---
type: concept
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [concept, llm, domain-logic, auditability]
---

**LLMs write prose. Never compute domain numbers. Numbers come from pure functions, templated into prompts. Default across supply-intelligence; should be default everywhere.**

## Rule

Output includes numbers (risk scores, stockout weeks, allocation counts, priority rankings)? Numbers **must** come from a deterministic function. LLM's job: readable prose around pre-computed values. Not arithmetic. Not classification.

## Why

- **Auditable** — every claim in output traces to a verifiable function call.
- **Reproducible** — same inputs → same numbers. LLM randomness irrelevant.
- **Testable** — domain logic covered by unit tests without LLM mocks.

## Applied in

- [`supply-intelligence-plugins`](../entities/packages/supply-intelligence-plugins.md) — numbers from [`supply-intelligence`](../entities/packages/supply-intelligence.md) (`fefoAllocation`, `stockoutProjection`, `classifyRisk`) + `lib/risk-computations.ts`. Prose from LLM with numbers templated in.

## Pattern for new plugins

1. Domain calculation → pure function (package or lib module).
2. Unit-test without mocks.
3. Template numbers into prompt via deterministic builder (see `packages/supply-intelligence-plugins/src/prompts/`).
4. LLM fills prose. Never ask LLM for the number.

## Sources

- `packages/supply-intelligence-plugins/src/driver-agent-plugin.ts`
- `packages/supply-intelligence/src/risk/`
