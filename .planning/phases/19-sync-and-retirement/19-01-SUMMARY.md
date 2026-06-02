---
phase: 19-sync-and-retirement
plan: 01
subsystem: model-registry
tags: [sync, retirement, rankings, retry, repository]
dependency_graph:
  requires: [18-01]
  provides: [listIds, retireAbsentModels, syncFromOpenRouter-enhanced, syncWithRetry]
  affects: [platform-core, platform-infra, platform-api]
tech_stack:
  added: []
  patterns: [TDD RED-GREEN, parity-contract-tests, drizzle-returning-for-affected-rows]
key_files:
  created: []
  modified:
    - packages/platform-core/src/repositories/model-registry-repository.ts
    - packages/platform-core/src/testing/in-memory-model-registry-repository.ts
    - packages/platform-infra/src/postgres/repositories/model-registry-repository.ts
    - packages/platform-infra/src/sync/openrouter-sync.ts
    - packages/platform-infra/src/index.ts
    - packages/platform-api/src/contract/models.ts
    - packages/platform-api/src/handlers/models/sync-models.ts
    - packages/platform-api/src/handlers/models/__tests__/sync-models.test.ts
    - packages/platform-infra/src/postgres/__tests__/model-registry-parity.test.ts
decisions:
  - "Use .returning({ id }) instead of rowCount for Drizzle UPDATE affected-row counting"
  - "syncFromOpenRouter returns lastSyncedAt directly (handler no longer overrides with new Date())"
  - "syncWithRetry loops maxRetries+1 times — first attempt is attempt 1, retries are 2..maxRetries+1"
metrics:
  duration: 4m42s
  completed_date: "2026-06-02"
  tasks_completed: 2
  files_modified: 9
---

# Phase 19 Plan 01: Sync and Retirement — Sync Foundation Summary

Model registry sync now retires absent models, reinstates returned ones, updates rankings, and retries on failure — all in a single sync pass with a shared repo interface.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Extend repository interface with listIds and retireAbsentModels | b6963211 | model-registry-repository.ts (interface + InMemory + Postgres), parity.test.ts |
| 2 | Enhance syncFromOpenRouter with retirement, rankings, and retry | ca5313f7 | openrouter-sync.ts, contract/models.ts, sync-models.ts, sync-models.test.ts |

## What Was Built

**Task 1 — Repository interface extensions:**
- `listIds(): Promise<string[]>` — lightweight ID-only fetch (no full entry serialization)
- `retireAbsentModels(presentIds: string[]): Promise<{ retired: number; reinstated: number }>` — atomically retires absent models (retired_at = NOW()) and reinstates returned ones (retired_at = null); handles empty presentIds edge case (retire all)
- Postgres implementation uses `.returning({ id })` to count affected rows (Drizzle's RowList does not expose rowCount)
- 5 new parity tests covering retirement, reinstatement, empty list, all-present, and listIds

**Task 2 — Enhanced sync:**
- `syncFromOpenRouter` now calls `retireAbsentModels(syncedIds)` after `bulkUpsert` and `updateRankings` with request counts from OpenRouter's `requests` field
- Returns `{ synced, total, retired, reinstated, rankingsUpdated, lastSyncedAt }`
- `syncWithRetry(repo, { maxRetries?, intervalMs? })` wraps `syncFromOpenRouter` with configurable retry loop; logs each retry; throws after all retries exhausted
- `SyncModelsOutputSchema` extended with `retired`, `reinstated`, `rankingsUpdated` fields
- All repo stubs in platform-api tests updated with `listIds` and `retireAbsentModels` stubs (4 files fixed)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Drizzle UPDATE does not expose rowCount**
- **Found during:** Task 1 implementation
- **Issue:** `result.rowCount` does not exist on Drizzle's `RowList<never[]>` return type from `.update()`
- **Fix:** Switched to `.returning({ id: modelRegistryEntries.id })` and counted the returned array length — consistent with the existing pattern used throughout platform-infra
- **Files modified:** `packages/platform-infra/src/postgres/repositories/model-registry-repository.ts`
- **Commit:** b6963211

**2. [Rule 2 - Missing] 4 existing test repo stubs missing new interface methods**
- **Found during:** Task 2 typecheck
- **Issue:** After extending ModelRegistryRepository interface, 4 test files had stubs missing `listIds` and `retireAbsentModels`
- **Fix:** Added stub implementations to get-model.test.ts, list-models.test.ts, update-rankings.test.ts, create-test-scope.ts
- **Files modified:** 4 test files
- **Commit:** ca5313f7

## Self-Check: PASSED

Files exist:
- FOUND: packages/platform-core/src/repositories/model-registry-repository.ts
- FOUND: packages/platform-infra/src/sync/openrouter-sync.ts
- FOUND: packages/platform-api/src/contract/models.ts

Commits exist:
- FOUND: b6963211 (Task 1)
- FOUND: ca5313f7 (Task 2)

Tests: 25 passed (0 failed), 21 skipped (Postgres parity skipped without TEST_DATABASE_URL)
Typecheck: clean (0 errors)
