---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 3
tags: [app, supply-intelligence, nextjs]
---

**Standalone Next.js dashboard. Supply-chain risk visualization + issue management. Port 9004.**

## Purpose

UI over [`supply-intelligence`](../packages/supply-intelligence.md). Ships separate from [platform-ui](../packages/platform-ui.md). Visualises risk rollups (category, SKU, operational). Surfaces draft issues from [risk-detection plugin](../plugins/supply-intelligence-risk-detection.md).

## Stack

- Next.js 16 App Router
- Radix UI + TanStack Table + Recharts
- Firebase (Firestore + Auth)
- Zod

## Routes

- `/` → `/overview`
- `/overview` — portfolio dashboard
- `/operational` — operational view
- `/sku/[id]` — SKU detail

## Dev / test

- Dev: `npm run dev` → port **9004** (not 9003 — that's platform-ui).
- E2E: Playwright; `NEXT_PUBLIC_USE_EMULATORS=true` for emulator tests.

## Relationships

- Depends on: [`supply-intelligence`](../packages/supply-intelligence.md).
- Reads Firestore writes from: [`supply-intelligence/risk-detection`](../plugins/supply-intelligence-risk-detection.md).
- **Does not** import: `platform-ui`, `platform-infra`.

## Sources

- `apps/supply-intelligence/src/app/page.tsx`
- `apps/supply-intelligence/src/app/layout.tsx`
- `apps/supply-intelligence/package.json`
