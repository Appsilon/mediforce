# Roadmap: Mediforce v1.4 Model Registry Reliability

## Milestones

- ✅ **v1.0 MVP** — Phases 1–6 (shipped 2026-02-27)
- ✅ **v1.1 Process Auto-Runner** — Phases 7–10 (shipped ~2026-03-02)
- ✅ **v1.2 Supply Intelligence** — Phases 11–13 (shipped 2026-03-03)
- ✅ **v1.3 Platform Evolution** — Phases 14–17 (shipped 2026-03-07)
- 🚧 **v1.4 Model Registry Reliability** — Phases 18–21 (in progress)

## Phases

<details>
<summary>✅ v1.0–v1.3 (Phases 1–17) — SHIPPED</summary>

Archived in `.planning/milestones/`.

</details>

### 🚧 v1.4 Model Registry Reliability (In Progress)

**Milestone Goal:** Model registry stays fresh via daily sync, retired models are surfaced to users, and workflows can't silently fail on stale or missing models.

- [x] **Phase 18: Schema Foundation** — Add `retired_at` column to `model_registry_entries` (completed 2026-06-02)
- [x] **Phase 19: Sync and Retirement** — Daily cron sync, boot-time eager sync, retry logic, rankings, and retirement writes (completed 2026-06-02)
- [x] **Phase 20: Editor and Pre-flight Validation** — Model picker hides/warns retired models; save and run blocked on retired model (completed 2026-06-02)
- [ ] **Phase 21: Alerting** — Audit log and webhook notification on sync failure

## Phase Details

### Phase 18: Schema Foundation
**Goal**: The `retired_at` column exists in the database so every downstream feature (sync writes, editor reads, validation reads, alerting) has the column it depends on.
**Depends on**: Nothing (first phase of this milestone)
**Requirements**: RET-01
**Success Criteria** (what must be TRUE):
  1. `model_registry_entries` table has a nullable `retired_at` timestamp column after running migrations.
  2. Existing rows are unaffected — all previously-active models remain active (retired_at is NULL).
  3. Drizzle ORM schema and TypeScript types reflect the new column; `pnpm typecheck` passes.
**Plans**: 1 plan
Plans:
- [ ] 18-01-PLAN.md — Add retired_at column: migration, Drizzle/Zod schema, repository mapper, parity tests

### Phase 19: Sync and Retirement
**Goal**: The sync job runs on schedule, writes retirement timestamps for removed models, clears them for reinstated models, updates rankings in the same pass, retries on failure, and runs eagerly at boot when the registry is stale.
**Depends on**: Phase 18
**Requirements**: SYNC-01, SYNC-02, SYNC-03, SYNC-04, SYNC-05, RET-02, RET-03
**Success Criteria** (what must be TRUE):
  1. Running `mediforce model sync` (or waiting for the 03:00 cron) sets `retired_at` on any model absent from the OpenRouter response and clears it on any model that has returned.
  2. The migrate container, when started after >24 h since last sync, completes a full sync before platform-ui accepts traffic.
  3. If the OpenRouter API is unavailable, the sync retries up to 3 times at 1-hour intervals before standing down until the next cron window.
  4. After a successful sync, model rankings (request counts) are updated in the same database transaction/pass — no separate job required.
**Plans**: 2 plans
Plans:
- [ ] 19-01-PLAN.md — Core sync logic: retirement, rankings, retry wrapper, repository interface extensions
- [ ] 19-02-PLAN.md — Scheduling: cron route, eager boot sync, migrate container update, CLI output

### Phase 20: Editor and Pre-flight Validation
**Goal**: Users cannot accidentally configure or start a workflow that depends on a retired model — the editor prevents it visually, and the run route blocks it programmatically.
**Depends on**: Phase 19
**Requirements**: EDIT-01, EDIT-02, EDIT-03, VAL-01, VAL-02
**Success Criteria** (what must be TRUE):
  1. The model picker dropdown does not list retired models; a user building a new workflow step cannot select one.
  2. Opening a workflow whose saved config references a retired model shows an inline warning identifying which step(s) are affected.
  3. Attempting to save a workflow step that references a retired model is blocked — the save button is disabled or the API returns a validation error.
  4. Attempting to start a run whose workflow config references a retired model returns HTTP 422 with an error message that names the retired model, the affected step(s), and the retirement date.
**Plans**: 2 plans
Plans:
- [ ] 20-01-PLAN.md — Backend validation: validateRetiredModels function, register-workflow block, run route 422
- [ ] 20-02-PLAN.md — Model picker UI: hide retired from list, show inline retirement warning

### Phase 21: Alerting
**Goal**: Platform administrators are notified when a sync fails, both via a persistent audit record and via a configurable push notification, so failures are caught without requiring anyone to check the UI proactively.
**Depends on**: Phase 19
**Requirements**: ALERT-01, ALERT-02, ALERT-03
**Success Criteria** (what must be TRUE):
  1. A failed sync produces an audit log entry that includes the error details and is visible in the platform audit trail.
  2. A failed sync triggers an HTTP POST to a configured Slack or Discord webhook URL containing a human-readable failure summary.
  3. The webhook URL and enabled/disabled state are configurable via an environment variable (or platform config) without code changes; disabling it suppresses the webhook call but not the audit log entry.
**Plans**: 2 plans
Plans:
- [ ] 21-01-PLAN.md — platform_settings table, PlatformSettingsRepository, audit logging in sync flows
- [ ] 21-02-PLAN.md — Webhook sender (Slack/Discord), config API routes, CLI commands (config set/get/test-webhook)

## Progress

**Execution Order:** 18 → 19 → 20 → 21

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 18. Schema Foundation | 1/1 | Complete    | 2026-06-02 | - |
| 19. Sync and Retirement | 2/2 | Complete    | 2026-06-02 | - |
| 20. Editor and Pre-flight Validation | 2/2 | Complete    | 2026-06-02 | - |
| 21. Alerting | 1/2 | In Progress|  | - |
