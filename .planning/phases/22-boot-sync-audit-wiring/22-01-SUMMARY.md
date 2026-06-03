---
phase: 22-boot-sync-audit-wiring
plan: 01
subsystem: infra
tags: [audit, sync, postgres, model-registry, cron]

# Dependency graph
requires:
  - phase: 21-alerting
    provides: auditRepo wired into cron sync path, sendSyncFailureWebhook, eagerSyncIfStale with optional auditRepo parameter
provides:
  - Boot-time sync failure audit path fully wired (auditRepo passed + namespace set)
  - maxRetries derived constant in cron route
affects: [21-alerting, 22-boot-sync-audit-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "System-level audit events use namespace: '_system' sentinel so PostgresAuditRepository can resolve workspace without a processInstanceId"
    - "PostgresProcessInstanceRepository constructed alongside PostgresAuditRepository in one-shot scripts — constructor demands it even if never queried at runtime"

key-files:
  created: []
  modified:
    - packages/platform-infra/src/sync/migrate-with-sync.ts
    - packages/platform-infra/src/sync/eager-sync.ts
    - packages/platform-ui/src/app/api/cron/model-sync/route.ts

key-decisions:
  - "Boot-time audit events use namespace '_system' — same sentinel documented in delete-image.ts TODO #592"
  - "ProcessInstanceRepository constructed in migrate-with-sync.ts even though system audit events never query it — constructor contract demands it"
  - "maxRetries extracted as named constant in cron route so syncWithRetry call and webhook attemptCount stay in sync"

patterns-established:
  - "namespace: '_system' on all system-actor audit events without a processInstanceId"

requirements-completed: [ALERT-01]

# Metrics
duration: 2min
completed: 2026-06-03
---

# Phase 22 Plan 01: Boot Sync Audit Wiring Summary

**ALERT-01 gap closed: boot-time eager sync failures now produce audit entries via PostgresAuditRepository with namespace '_system', and cron route attemptCount derived from maxRetries constant**

## Performance

- **Duration:** 2 min
- **Started:** 2026-06-03T11:54:07Z
- **Completed:** 2026-06-03T11:56:19Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Wired PostgresAuditRepository (+ PostgresProcessInstanceRepository) into migrate-with-sync.ts and passed it to eagerSyncIfStale
- Added `namespace: '_system'` to audit event in eager-sync.ts so PostgresAuditRepository.append can resolve workspace without a processInstanceId
- Extracted `maxRetries = 3` as a named constant in the cron route and replaced hardcoded `attemptCount: 4` with `maxRetries + 1`

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire auditRepo into boot-time sync and fix namespace** - `9aa02c08` (feat)
2. **Task 2: Derive attemptCount from maxRetries in cron route** - `ec1a94c2` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `packages/platform-infra/src/sync/migrate-with-sync.ts` - Added imports for PostgresAuditRepository + PostgresProcessInstanceRepository; constructs and passes auditRepo to eagerSyncIfStale
- `packages/platform-infra/src/sync/eager-sync.ts` - Added `namespace: '_system'` to audit event in failure catch block
- `packages/platform-ui/src/app/api/cron/model-sync/route.ts` - Extracted maxRetries constant, passed to syncWithRetry, replaced hardcoded attemptCount: 4

## Decisions Made

- Boot-time audit events use `namespace: '_system'` sentinel — same pattern noted in platform-api delete-image.ts TODO #592
- ProcessInstanceRepository is constructed alongside PostgresAuditRepository in migrate-with-sync.ts even though system-scoped events never query it — required by the constructor signature
- `maxRetries = 3` mirrors syncWithRetry's default, keeping the cron caller and the function default aligned

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- ALERT-01 requirement fully satisfied: both boot path (eager sync) and cron path have audit coverage
- All sync failure paths produce audit trail entries as required by v1.4 milestone
- Phase 22 is the final gap-closure phase in the v1.4 milestone

---
*Phase: 22-boot-sync-audit-wiring*
*Completed: 2026-06-03*
