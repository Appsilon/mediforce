---
phase: 20-editor-preflight-validation
plan: 01
subsystem: api
tags: [validation, model-registry, workflow, pre-flight, agent-runtime]

# Dependency graph
requires:
  - phase: 19-sync-and-retirement
    provides: "retiredAt field on ModelRegistryEntry, retire absent models logic"
provides:
  - validateRetiredModels function in agent-runtime (exported from index)
  - RetiredModelRef interface
  - register-workflow handler rejects workflows with retired model references
  - run route returns HTTP 422 when pre-flight finds retired model in workflow
affects:
  - 20-02-editor-ui (editor needs to call register-workflow and handle retired model error)

# Tech tracking
tech-stack:
  added: []
  patterns: [retired-model pre-flight validation parallel to existing unknown-model check]

key-files:
  created: []
  modified:
    - packages/agent-runtime/src/plugins/resolve-env.ts
    - packages/agent-runtime/src/plugins/__tests__/resolve-env.test.ts
    - packages/agent-runtime/src/index.ts
    - packages/platform-api/src/handlers/workflows/register-workflow.ts
    - packages/platform-api/src/handlers/workflows/__tests__/register-workflow.test.ts
    - packages/platform-ui/src/app/api/processes/[instanceId]/run/route.ts

key-decisions:
  - "validateRetiredModels takes Map<modelId, retiredAt> not a full model list — caller builds the map, function stays pure"
  - "register-workflow throws ValidationError (400) on retired model; run route returns 422 — same status codes as the unknown-model equivalents"
  - "allModels hoisted above both unknown-model and retired-model blocks in run route — single list() call covers both checks"

patterns-established:
  - "Pre-flight pattern: build derived Set/Map from allModels, call validate function, handle non-empty result with 422 and instance pause"

requirements-completed: [EDIT-03, VAL-01, VAL-02]

# Metrics
duration: 4min
completed: 2026-06-02
---

# Phase 20 Plan 01: Retired Model Validation Summary

**validateRetiredModels function blocks saving/running workflows that reference retired models — ValidationError at save time, HTTP 422 with model name, step name, and retirement date at run time**

## Performance

- **Duration:** 4 min
- **Started:** 2026-06-02T12:59:09Z
- **Completed:** 2026-06-02T13:02:43Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- `validateRetiredModels` function in `resolve-env.ts` with `RetiredModelRef` interface — mirrors `validateWorkflowModels` pattern, takes `Map<modelId, retiredAt>`, normalises Firestore-encoded IDs
- 6 new unit tests covering all edge cases: no retired models, retirement detection, optional model, non-agent executors, grouping, ID normalisation
- register-workflow handler calls `validateRetiredModels` after schema parse, throws `ValidationError` with model name, retirement date, and step names
- run/route.ts hoists `allModels` fetch and adds retired-model check block after unknown-model block, returns 422 with `retiredModels` array
- L2 handler tests prove rejection and non-regression

## Task Commits

Each task was committed atomically:

1. **Task 1: Add validateRetiredModels function with tests** - `bc04cb76` (feat)
2. **Task 2: Wire retired model validation into register-workflow and run route** - `9d63121b` (feat)

## Files Created/Modified
- `packages/agent-runtime/src/plugins/resolve-env.ts` - Added `RetiredModelRef` interface and `validateRetiredModels` function
- `packages/agent-runtime/src/plugins/__tests__/resolve-env.test.ts` - 6 new tests for `validateRetiredModels`
- `packages/agent-runtime/src/index.ts` - Exported `validateRetiredModels` and `RetiredModelRef`
- `packages/platform-api/src/handlers/workflows/register-workflow.ts` - Added retired model validation before version increment
- `packages/platform-api/src/handlers/workflows/__tests__/register-workflow.test.ts` - L2 tests: rejection on retired model, success on non-retired
- `packages/platform-ui/src/app/api/processes/[instanceId]/run/route.ts` - Hoisted allModels fetch, added retired-model pre-flight block

## Decisions Made
- `validateRetiredModels` takes a `Map<modelId, retiredAt>` (not the full entry list) so the function stays pure and callers build the derived map — mirrors how `validateWorkflowModels` takes a `Set<string>` rather than the full model list
- register-workflow throws `ValidationError` (mapped to 400) on retired model; run route returns explicit 422 — matches the existing unknown-model equivalents
- `allModels` hoisted above both checks in run route to avoid a redundant `list()` call

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Import path for `ValidationError` in the test file was given as `'../../errors'` in plan action text but the correct relative path from `__tests__/` is `'../../../errors'` — auto-corrected on first test run.

## Next Phase Readiness
- `validateRetiredModels` exported and fully tested; register-workflow and run route both enforce retirement
- Phase 20-02 (editor UI) can call `registerWorkflow` and handle `ValidationError` with retired model message to surface warnings in the editor

---
*Phase: 20-editor-preflight-validation*
*Completed: 2026-06-02*
