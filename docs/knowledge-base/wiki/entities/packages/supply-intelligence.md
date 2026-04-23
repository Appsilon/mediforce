---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 4
tags: [package, supply-intelligence, domain, pure]
---

**Pure supply-chain domain package — SKU / warehouse / batch / forecast schemas plus pure-function risk services. No Firebase, no platform-core dependency.**

## Purpose

Domain logic for pharmaceutical supply-chain intelligence. Defines the data model (SKUs, warehouses, batches with lot numbers and expiry dates, demand forecasts) and deterministic risk algorithms (FEFO allocation, stockout projection, red/orange/green classification). Intentionally free of infrastructure and `@mediforce/*` dependencies so it can be embedded anywhere — used by the `supply-intelligence` app and wrapped by `supply-intelligence-plugins`.

## Dependencies

- Internal: none
- External: `zod`, `date-fns`

## Key exports

- **Schemas (Zod)**: `SkuSchema`, `WarehouseSchema`, `BatchSchema`, `InboundShipmentSchema`, `DemandForecastSchema`, `RiskConfigSchema`.
- **Risk services** (pure functions):
  - `fefoAllocation()` — FIFO-by-expiry batch allocation.
  - `stockoutProjection()` — 4-week demand forecast.
  - `classifyRisk()` — red / orange / green classification combining absolute thresholds with urgency triggers.
- **Seed**: `src/seed/run-seed.ts` — dev data generator.

## Key internal modules

- `src/schemas/` — domain entity schemas.
- `src/risk/` — pure algorithm functions (`fefo-allocation.ts`, `stockout-projection.ts`, `risk-classification.ts`).
- `src/risk/__tests__/` — Vitest unit tests with fixtures; no mocks needed because there are no side effects.
- `src/seed/` — data generator.

## Notable properties

- No external infrastructure — no Firebase, no HTTP, no filesystem.
- Pure functions everywhere — testable without mocks.
- Risk urgency logic: urgency triggers (expiry days, stockout weeks) only fire when base risk > 0.

## Relationships

- Consumed by: [`supply-intelligence-plugins`](./supply-intelligence-plugins.md), [`apps/supply-intelligence`](../apps/supply-intelligence.md).
- Depends on: nothing internal.

## Sources

- `packages/supply-intelligence/src/index.ts`
- `packages/supply-intelligence/src/schemas/sku.ts`
- `packages/supply-intelligence/src/risk/risk-classification.ts`
- `packages/supply-intelligence/src/risk/__tests__/fefo-allocation.test.ts`
- `packages/supply-intelligence/package.json`
