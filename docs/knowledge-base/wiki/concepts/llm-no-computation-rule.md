---
type: concept
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [concept, llm, domain-logic, auditability]
---

**LLMs generate prose; they never compute domain numbers. Numbers come from deterministic pure functions and are templated into prompts. Applied across supply-intelligence and should be the default elsewhere.**

## The rule

When a plugin produces output that includes numbers (risk scores, stockout weeks, allocation counts, priority rankings), those numbers **must** come from a deterministic function. The LLM's job is to write readable prose around pre-computed values, not to do arithmetic or classification itself.

## Why

- **Auditability** — every claim in the output traces back to a verifiable function call.
- **Reproducibility** — same inputs → same numbers, regardless of LLM randomness.
- **Testability** — domain logic is covered by unit tests without mocking LLMs.

## Applied in

- [`supply-intelligence-plugins`](../entities/packages/supply-intelligence-plugins.md) — numbers come from [`supply-intelligence`](../entities/packages/supply-intelligence.md) (`fefoAllocation`, `stockoutProjection`, `classifyRisk`) and `lib/risk-computations.ts`. Prose comes from LLM with those numbers templated into the prompt.

## Pattern for new plugins

1. Put the domain calculation in a pure function (package or lib module).
2. Unit-test the function without mocks.
3. Template numbers into the prompt via a deterministic prompt-builder (see `packages/supply-intelligence-plugins/src/prompts/`).
4. LLM fills in prose. Never ask the LLM for the number.

## Sources

- `packages/supply-intelligence-plugins/src/driver-agent-plugin.ts`
- `packages/supply-intelligence/src/risk/`
