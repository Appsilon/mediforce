# Requirements: Mediforce v1.4 Model Registry Reliability

**Defined:** 2026-06-02
**Core Value:** Model registry stays fresh, retired models are surfaced to users, workflows can't silently fail on stale models.

## v1.4 Requirements

### Sync Infrastructure

- [x] **SYNC-01**: Model registry syncs from OpenRouter daily via cron (`0 3 * * *`)
- [x] **SYNC-02**: Migrate container runs eager sync on boot if last sync >24h ago
- [x] **SYNC-03**: Failed sync retries 3 times at 1hr intervals before waiting for next cron
- [x] **SYNC-04**: Rankings (request counts) update in same sync job
- [x] **SYNC-05**: Sync retires models removed from OpenRouter (sets `retired_at`)

### Retirement

- [x] **RET-01**: `model_registry_entries` has `retired_at` timestamp column
- [x] **RET-02**: Models not in OpenRouter response get `retired_at = NOW()` during sync
- [x] **RET-03**: Models reappearing in OpenRouter get `retired_at` cleared

### Workflow Editor

- [ ] **EDIT-01**: Model picker hides retired models from selection list
- [ ] **EDIT-02**: Model picker shows warning if workflow already uses a retired model
- [ ] **EDIT-03**: Workflow save blocked when step uses a retired model

### Run Validation

- [ ] **VAL-01**: Pre-flight validation blocks run start (422) when step uses a retired model
- [ ] **VAL-02**: Error message names the retired model, affected step(s), and retirement date

### Alerting

- [ ] **ALERT-01**: Failed sync logged in audit trail with error details
- [ ] **ALERT-02**: Failed sync triggers Slack/Discord webhook notification
- [ ] **ALERT-03**: Webhook is configurable (URL, enabled/disabled) via env var or platform config

## Future Requirements

- Model cost tracking / spend alerts per workspace
- Custom model registration (non-OpenRouter sources)
- Model performance benchmarking (latency, success rate)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-provider sync (Azure, Bedrock) | Only OpenRouter for now; single source of truth |
| Model cost limits / budget enforcement | Future milestone — needs workspace billing model |
| Hard-delete of retired models | Workflow definitions may still reference them |
| UI for manual model sync trigger | CLI `mediforce model sync` covers this |
| Per-workspace model allowlists | Future enterprise feature |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| RET-01 | Phase 18 | Complete |
| SYNC-01 | Phase 19 | Complete |
| SYNC-02 | Phase 19 | Complete |
| SYNC-03 | Phase 19 | Complete |
| SYNC-04 | Phase 19 | Complete |
| SYNC-05 | Phase 19 | Complete |
| RET-02 | Phase 19 | Complete |
| RET-03 | Phase 19 | Complete |
| EDIT-01 | Phase 20 | Pending |
| EDIT-02 | Phase 20 | Pending |
| EDIT-03 | Phase 20 | Pending |
| VAL-01 | Phase 20 | Pending |
| VAL-02 | Phase 20 | Pending |
| ALERT-01 | Phase 21 | Pending |
| ALERT-02 | Phase 21 | Pending |
| ALERT-03 | Phase 21 | Pending |

**Coverage:**
- v1.4 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0

---
*Requirements defined: 2026-06-02*
*Last updated: 2026-06-02 — traceability filled after roadmap creation*
