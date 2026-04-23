---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 3
tags: [app, supply-intelligence, nextjs]
---

**Standalone Next.js dashboard for supply-chain risk analysis, visualization, and issue management.**

## Purpose

User-facing UI on top of the [`supply-intelligence`](../packages/supply-intelligence.md) domain. Distinct from the main [`platform-ui`](../packages/platform-ui.md) — lives in `apps/supply-intelligence/` and ships independently. Visualises risk rollups (therapeutic category, SKU detail, operational view) and surfaces draft issues produced by the [`supply-intelligence/risk-detection` plugin](../plugins/supply-intelligence-risk-detection.md).

## Stack

- Next.js 16 App Router
- Radix UI + TanStack Table + Recharts
- Firebase (Firestore + Auth)
- Zod

## Routes

- `/` → redirects to `/overview`
- `/overview` — portfolio dashboard
- `/operational` — operational view
- `/sku/[id]` — SKU detail

## Dev / test

- Dev: `npm run dev` on port **9004** (distinct from `platform-ui` on 9003).
- E2E: Playwright; `NEXT_PUBLIC_USE_EMULATORS=true` for emulator-backed tests.

## Relationships

- Depends on: [`supply-intelligence`](../packages/supply-intelligence.md).
- Consumes Firestore writes from: [`supply-intelligence/risk-detection`](../plugins/supply-intelligence-risk-detection.md).
- Does **not** import `platform-ui` or `platform-infra`.

## Sources

- `apps/supply-intelligence/src/app/page.tsx`
- `apps/supply-intelligence/src/app/layout.tsx`
- `apps/supply-intelligence/package.json`
