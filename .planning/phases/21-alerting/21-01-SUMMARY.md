---
phase: 21-alerting
plan: "01"
subsystem: database
tags: [postgres, drizzle, audit-log, platform-settings, key-value, sync]

# Dependency graph
requires:
  - phase: 19-sync-and-retirement
    provides: syncWithRetry, eagerSyncIfStale, ModelRegistryRepository
  - phase: 18-schema-foundation
    provides: Drizzle migration pattern, platform-infra postgres structure
provides:
  - platform_settings Drizzle schema + migration 0019
  - PlatformSettingsRepository interface (platform-core)
  - PostgresPlatformSettingsRepository + InMemoryPlatformSettingsRepository
  - platformSettingsRepo wired in getPlatformServices
  - syncWithRetry onAttemptFail callback for per-attempt audit emission
  - Cron route emits audit per failed attempt, on success, and on final failure
  - eagerSyncIfStale emits audit on boot-time failure when auditRepo provided
affects: [21-02, any consumer of getPlatformServices, CLI config commands]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - General platform key-value store via platform_settings table (key, value, updated_at)
    - Per-attempt audit callbacks via optional onAttemptFail in syncWithRetry
    - System-actor CallerIdentity ({ kind: 'apiKey', isSystemActor: true }) for cron audits
    - auditRepo.append directly in infra (not emitAudit) to avoid api->infra dep inversion

key-files:
  created:
    - packages/platform-infra/src/postgres/schema/platform-settings.ts
    - packages/platform-infra/src/postgres/migrations/0019_platform_settings.sql
    - packages/platform-infra/src/postgres/migrations/meta/0019_snapshot.json
    - packages/platform-core/src/repositories/platform-settings-repository.ts
    - packages/platform-core/src/testing/in-memory-platform-settings-repository.ts
    - packages/platform-infra/src/postgres/repositories/platform-settings-repository.ts
    - packages/platform-infra/src/postgres/repositories/__tests__/platform-settings-parity.test.ts
  modified:
    - packages/platform-infra/src/postgres/schema/index.ts
    - packages/platform-infra/src/postgres/migrations/meta/_journal.json
    - packages/platform-infra/src/index.ts
    - packages/platform-core/src/index.ts
    - packages/platform-core/src/testing/index.ts
    - packages/platform-api/src/services/platform-services.ts
    - packages/platform-api/src/index.ts
    - packages/platform-infra/src/sync/openrouter-sync.ts
    - packages/platform-infra/src/sync/eager-sync.ts
    - packages/platform-ui/src/app/api/cron/model-sync/route.ts

key-decisions:
  - "Migration generated manually (0019_platform_settings.sql + snapshot) because drizzle-kit generate fails due to pre-existing snapshot collision on this branch (fix/migration-pk-conflict)"
  - "emitAudit and auditActorFrom exported from @mediforce/platform-api public index to allow cron route in platform-ui to use them"
  - "eagerSyncIfStale uses auditRepo.append directly rather than emitAudit to maintain dep direction: platform-infra must not depend on platform-api"
  - "syncWithRetry onAttemptFail is void | Promise<void> — callers must wrap emitAudit (which returns Promise<string>) in async wrapper"

patterns-established:
  - "Platform-global config via platform_settings key-value table with dot-notation keys"
  - "Audit callbacks as optional opts fields in sync functions — callers supply audit context"
  - "System-actor cron events: CallerIdentity { kind: 'apiKey', isSystemActor: true }"

requirements-completed: [ALERT-01, ALERT-03]

# Metrics
duration: 8min
completed: 2026-06-02
---

# Phase 21 Plan 01: DB Foundation and Audit Emission Summary

**platform_settings key-value table (migration 0019) + audit entries wired into cron sync (per-attempt failure, success, final failure) and boot-time eager sync (failure only)**

## Performance

- **Duration:** 8 min
- **Started:** 2026-06-02T16:33:47Z
- **Completed:** 2026-06-02T16:41:50Z
- **Tasks:** 2
- **Files modified:** 18

## Accomplishments

- Created platform_settings Drizzle schema and migration 0019 (key TEXT PK, value TEXT, updated_at TIMESTAMPTZ)
- PlatformSettingsRepository interface + InMemory and Postgres implementations with parity tests
- platformSettingsRepo wired into getPlatformServices
- syncWithRetry extended with optional onAttemptFail callback (backward-compatible)
- Cron route now emits audit entries per failed attempt, on success, and on final failure
- eagerSyncIfStale emits audit on failure when auditRepo provided; never blocks boot

## Task Commits

1. **Task 1: platform_settings table, repository, and getPlatformServices wiring** - `ef47ce78` (feat)
2. **Task 2: Wire audit logging into syncWithRetry, cron route, and eager sync** - `ba19ce32` (feat)

## Files Created/Modified

- `packages/platform-infra/src/postgres/schema/platform-settings.ts` - Drizzle schema for platform_settings
- `packages/platform-infra/src/postgres/migrations/0019_platform_settings.sql` - DDL migration
- `packages/platform-infra/src/postgres/migrations/meta/0019_snapshot.json` - Drizzle snapshot
- `packages/platform-core/src/repositories/platform-settings-repository.ts` - Repository interface
- `packages/platform-core/src/testing/in-memory-platform-settings-repository.ts` - Test double backed by Map
- `packages/platform-infra/src/postgres/repositories/platform-settings-repository.ts` - Postgres impl with LIKE prefix query
- `packages/platform-infra/src/postgres/repositories/__tests__/platform-settings-parity.test.ts` - 5 parity tests (InMemory + Postgres gated)
- `packages/platform-api/src/services/platform-services.ts` - Added platformSettingsRepo to interface and factory
- `packages/platform-api/src/index.ts` - Export emitAudit + auditActorFrom publicly
- `packages/platform-infra/src/sync/openrouter-sync.ts` - Added onAttemptFail callback to syncWithRetry
- `packages/platform-infra/src/sync/eager-sync.ts` - Added optional auditRepo for failure audit
- `packages/platform-ui/src/app/api/cron/model-sync/route.ts` - Full audit emission: per-attempt, success, final failure

## Decisions Made

- **Manual migration creation**: drizzle-kit generate fails on this branch due to a pre-existing snapshot collision (0016 and 0017 share the same UUID). Created 0019_platform_settings.sql and snapshot manually using the same pattern as other migrations.
- **emitAudit export**: Added emitAudit and auditActorFrom to @mediforce/platform-api public index so the cron route in platform-ui can import them without breaking the headless-API contract.
- **Direct auditRepo.append in eager-sync**: The eagerSyncIfStale function lives in platform-infra and must not depend on platform-api (dep direction). Uses auditRepo.append directly with explicit actor fields.
- **onAttemptFail type**: The callback is `void | Promise<void>` — emitAudit returns `Promise<string>`, so callers must wrap it in an async wrapper (auto-fixed during typecheck).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed onAttemptFail type mismatch**
- **Found during:** Task 2 (cron route wiring)
- **Issue:** emitAudit returns Promise<string> but onAttemptFail expects void | Promise<void> — TypeScript error TS2322
- **Fix:** Wrapped emitAudit call in async wrapper function instead of passing directly as arrow expression
- **Files modified:** packages/platform-ui/src/app/api/cron/model-sync/route.ts
- **Verification:** pnpm typecheck clean
- **Committed in:** ba19ce32

---

**Total deviations:** 1 auto-fixed (1 type bug)
**Impact on plan:** Type-safety fix only, no behavior change.

## Issues Encountered

- drizzle-kit generate fails on this branch due to pre-existing migration collision (0016 and 0017 have the same snapshot UUID). Migration created manually following the established SQL + JSON snapshot pattern. This is a pre-existing issue unrelated to this plan's changes.

## Next Phase Readiness

- Plan 21-02 can read/write platform_settings for webhook configuration (alert.webhook.url, alert.webhook.type, alert.webhook.enabled)
- Audit trail is live for all sync operations — Plan 02 webhook fires after all retries exhausted (final failure only)
- getPlatformServices exposes platformSettingsRepo for use in webhook-firing handlers

## Self-Check: PASSED

All key files found. Commits ef47ce78 and ba19ce32 verified in git log.

---
*Phase: 21-alerting*
*Completed: 2026-06-02*
