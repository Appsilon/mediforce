---
phase: 18-schema-foundation
plan: 01
subsystem: model-registry
tags: [migration, schema, drizzle, zod, repository]
dependency_graph:
  requires: []
  provides: [retired_at-column, retiredAt-zod-field, retiredAt-repository-mapper]
  affects: [platform-core/schemas/model-registry, platform-infra/schema/model-registry, platform-infra/repositories/model-registry-repository, platform-infra/migrations]
tech_stack:
  added: []
  patterns: [nullable-timestamp-soft-delete, drizzle-migration-snapshot]
key_files:
  created:
    - packages/platform-infra/src/postgres/migrations/0018_add_retired_at.sql
    - packages/platform-infra/src/postgres/migrations/meta/0018_snapshot.json
  modified:
    - packages/platform-infra/src/postgres/schema/model-registry.ts
    - packages/platform-core/src/schemas/model-registry.ts
    - packages/platform-infra/src/postgres/repositories/model-registry-repository.ts
    - packages/platform-infra/src/postgres/migrations/meta/_journal.json
    - packages/platform-infra/src/postgres/__tests__/model-registry-parity.test.ts
    - packages/platform-infra/src/sync/openrouter-sync.ts
    - packages/platform-api/src/handlers/models/__tests__/get-model.test.ts
    - packages/platform-api/src/handlers/models/__tests__/list-models.test.ts
    - packages/platform-api/src/handlers/models/__tests__/sync-models.test.ts
    - packages/platform-api/src/handlers/models/__tests__/update-rankings.test.ts
decisions:
  - Nullable retired_at timestamp (no NOT NULL) so existing rows get NULL without a DEFAULT — additive-only migration
  - retiredAt omitted from CreateModelRegistryEntryInputSchema.omit list so callers must pass null explicitly — forces awareness of the field
metrics:
  duration: 3m23s
  completed_date: "2026-06-02"
  tasks_completed: 1
  files_changed: 12
---

# Phase 18 Plan 01: Add retired_at Column — Schema Foundation Summary

Nullable `retired_at` timestamp column added to `model_registry_entries` via additive migration, with full Drizzle schema, Zod type, and repository mapper coverage. Foundation for Phases 19-21 soft-delete retirement model.

## What Was Built

Additive migration (`0018_add_retired_at.sql`) with snapshot and journal entry, Drizzle `retiredAt` column, `ModelRegistryEntrySchema` field `retiredAt: z.string().nullable()`, and full repository mapper (toEntry / toRowValues / upsert / bulkUpsert / update). Parity test suite extended with four new `retiredAt` contract tests covering null round-trip, ISO timestamp round-trip, update/clear cycle, and list inclusion.

## Commits

| Hash | Message |
|------|---------|
| 511dc380 | feat(18-01): add nullable retired_at column to model_registry_entries |

## Test Results

- InMemory parity: 15/15 passed
- Postgres parity: 16 skipped (no TEST_DATABASE_URL in env — runs in CI)
- typecheck: 0 errors

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing required field] Updated test fixtures in platform-api handlers**
- **Found during:** Task 1 (typecheck)
- **Issue:** `stubEntry()` and `makeEntry()` in 4 handler test files created `ModelRegistryEntry` objects without `retiredAt`, which became a TS error after the Zod schema change
- **Fix:** Added `retiredAt: null` to all 4 stub/makeEntry functions
- **Files modified:** `packages/platform-api/src/handlers/models/__tests__/{get-model,list-models,sync-models,update-rankings}.test.ts`
- **Commit:** 511dc380

**2. [Rule 2 - Missing required field] Updated openrouter-sync transformModel**
- **Found during:** Task 1 (typecheck)
- **Issue:** `transformModel()` in `openrouter-sync.ts` returned a `CreateModelRegistryEntryInput` without `retiredAt`, which is now required
- **Fix:** Added `retiredAt: null` to the `transformModel` return object (synced models are never retired at sync time)
- **Files modified:** `packages/platform-infra/src/sync/openrouter-sync.ts`
- **Commit:** 511dc380

## Self-Check

Files exist:
- packages/platform-infra/src/postgres/migrations/0018_add_retired_at.sql
- packages/platform-infra/src/postgres/migrations/meta/0018_snapshot.json
- packages/platform-infra/src/postgres/schema/model-registry.ts (retiredAt column)
- packages/platform-core/src/schemas/model-registry.ts (retiredAt field)
