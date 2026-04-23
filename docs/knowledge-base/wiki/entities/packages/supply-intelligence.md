---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 4
tags: [package, supply-intelligence, domain, pure]
---

**Pure supply-chain domain. SKU / warehouse / batch / forecast schemas + pure-function risk services. Zero Firebase, zero `@mediforce/*` deps.**

## Purpose

Domain logic for pharma supply-chain intelligence. Data model (SKUs, warehouses, batches with lot numbers + expiry, demand forecasts) + deterministic risk algorithms (FEFO allocation, stockout projection, red/orange/green classification). Infra-free by design — embeddable anywhere. Consumed by the [supply-intelligence app](../apps/supply-intelligence.md) + wrapped by [supply-intelligence-plugins](./supply-intelligence-plugins.md).

## Dependencies

- Internal: none.
- External: `zod`, `date-fns`.

## Key exports

- **Schemas (Zod)**: `SkuSchema`, `WarehouseSchema`, `BatchSchema`, `InboundShipmentSchema`, `DemandForecastSchema`, `RiskConfigSchema`.
- **Risk services** (pure):
  - `fefoAllocation()` — FIFO-by-expiry batch allocation.
  - `stockoutProjection()` — 4-week demand forecast.
  - `classifyRisk()` — red / orange / green = threshold + urgency triggers.
- **Seed**: `src/seed/run-seed.ts`.

## Key internal modules

- `src/schemas/` — domain entity schemas.
- `src/risk/` — pure algo functions.
- `src/risk/__tests__/` — Vitest fixtures, no mocks needed.
- `src/seed/` — data generator.

## Notable properties

- No external infra. No Firebase, no HTTP, no filesystem.
- Pure functions. Testable without mocks.
- Urgency triggers (expiry days, stockout weeks) fire only when base risk > 0.

## Relationships

- Consumed by: [`supply-intelligence-plugins`](./supply-intelligence-plugins.md), [`apps/supply-intelligence`](../apps/supply-intelligence.md).
- Depends on: nothing internal.

## Sources

- `packages/supply-intelligence/src/index.ts`
- `packages/supply-intelligence/src/schemas/sku.ts`
- `packages/supply-intelligence/src/risk/risk-classification.ts`
- `packages/supply-intelligence/src/risk/__tests__/fefo-allocation.test.ts`
- `packages/supply-intelligence/package.json`
