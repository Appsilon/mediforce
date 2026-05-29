# Cutover Checklist — Firestore → Postgres (ADR-0001)

Operator runbook. Iterative — every phase is observable, reversible, and
re-runnable. Treat this as a dry-run-first discipline: nothing destructive
to production until staging round-trip is clean.

The cutover script (`main.py`) was generated one-shot and is **not unit-tested**.
Bugs are expected. Iterate per-table, fix, re-run, verify.

> **File ownership.** This checklist and the migration script
> (`main.py`, `verify.py`, `requirements.txt`, `README.md`) ship
> together; path references in this doc resolve against the repo root.
>
> Pre-cutover host prep (`POSTGRES_PASSWORD` in `/opt/mediforce/.env`,
> bind-mount data dir) lives in
> [`docs/staging-postgres-prep.md`](../../docs/staging-postgres-prep.md).
> Do that before §0 Pre-flight below.

---

## High-level plan (staging cutover)

End-to-end flow from "migration PR ready" to "staging on Postgres only".
Sections §0–§5 + Rollback are the operator-level details for the
migration script itself; this overview chains them together with the
merge + deploy gates around them.

| Phase | What | Owner action | Exit gate | Details |
|---|---|---|---|---|
| **A** | Staging host prep | Re-run `bootstrap-server.py --from-step 10 --dry-run` then real, against existing staging server. Adds `POSTGRES_PASSWORD`, creates `/var/lib/mediforce/postgres-data` with UID 999. | `grep POSTGRES_PASSWORD /opt/mediforce/.env` returns one line; dir owned by 999:999 | [`docs/staging-postgres-prep.md`](../../docs/staging-postgres-prep.md) |
| **B** | Deploy Postgres container (dormant) | CI deploys the migration build to staging — Postgres container starts alongside the app, schema migrated, no data yet. | `docker compose ps` shows `postgres` healthy; `psql … '\dt'` shows the migrated schema | Smoke section of staging-postgres-prep.md |
| **D** | Local dry-run + per-table iteration | Pull staging Firestore export to local emulator. Run `main.py --dry-run` against local Postgres. Iterate per-table until verify.py clean. | All §2 tables verified locally | §0–§3 below |
| **E** | Staging data cutover (script execution) | Run `main.py` against staging Postgres (SSH-tunnel `5432` or `scp` script onto host). Accept staging Firestore writes lost between cut and the Postgres-only deploy. | `verify.py` exits 0 | §0–§3 (against staging) |
| **F** | Cut staging over to Postgres | Deploy the migration build; container reboots reading from Postgres (the only backend). | App boots; `pnpm exec mediforce workflow list` returns staging workflows; no 500s on `/api/*` | §4 below |
| **G** | Post-cutover cleanup | Watch staging 24h. If clean: delete `docs/staging-postgres-prep.md`. | No errors 24h | — |
| **H** | Production cutover (later, separate change) | Repeat A–F against production. Pre-conditions: staging has been on Postgres cleanly for ≥1 week, Firestore export to GCS taken, maintenance window announced, read-only flag wired. | `verify.py` exits 0 on prod | §5 below |

**Sequencing constraints (load-bearing):**

- Phase A **must** finish before B's CI deploy — otherwise the
  `postgres: service_healthy` gate hangs `platform-ui` forever and
  staging is down.
- E happens **after** B (Postgres container exists) and **before** F
  (data must land before the app starts reading from it).
- Anything beyond G is explicitly out of scope for the cutover window.

**What this plan does NOT cover** (separate work):

- Realtime push ADR (writer-driven Redis pub/sub + SSE) — PLAN-0001 §11.
- Firebase Auth → NextAuth (ADR-0002) — runs in parallel, independent
  cutover.
- `Namespace → Workspace` code rename — PLAN-0001 §4 follow-up.

---

## 0. Pre-flight (~1–2h, once per environment)

- [ ] GCP read access confirmed:
      `gcloud auth application-default login` **or**
      `export GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa-key.json`
- [ ] Service account has Firestore read on the source project.
- [ ] Local Postgres provisioned + migrated:
      ```sh
      docker compose up -d postgres
      DATABASE_URL='postgresql://mediforce:mediforce@localhost:5432/mediforce' \
        pnpm db:migrate
      ```
- [ ] Python deps installed:
      ```sh
      cd scripts/migrate-firestore-to-postgres
      python3 -m venv .venv && source .venv/bin/activate
      pip install -r requirements.txt
      ```
- [ ] `main.py --help` and `verify.py --help` both print without error.

## 1. Dry-run sanity (~30 min)

Reads only. No writes to Postgres. Logs the SQL it *would* execute.

```sh
python3 main.py \
  --firebase-project=mediforce-staging \
  --database-url=postgresql://mediforce:mediforce@localhost:5432/mediforce \
  --dry-run \
  --log-file=dryrun.json
```

- [ ] Exit code 0
- [ ] `dryrun.json` shows non-zero counts per expected table
- [ ] Eyeball first ~50 rows of generated SQL per table — field mapping looks right
- [ ] camelCase → snake_case translation matches Drizzle schemas in
      `packages/platform-infra/src/postgres/schema/`
- [ ] jsonb columns (e.g. `config`, `completion_data`, `ui`) — shape matches
      `packages/platform-core/src/schemas/`
- [ ] `process_instance_id` + `agent_run_id` FK columns remain as `text`
      (Firestore-shape IDs, not uuid)
- [ ] Timestamps: Firestore `Timestamp` → Postgres `timestamptz` not stringified
- [ ] Sub-collections (`stepExecutions`, `agentEvents`, `members`) iterated,
      not skipped

## 2. Per-table iteration (~2–4h, iterative)

Order matters — FK dependencies. Match PLAN-0001 §5.2.

```
namespaces → workspaces                      (1)
namespaces/{h}/members → workspace_members   (2)
workflowDefinitions → workflow_definitions   (3)
workflowMeta → workflow_meta                 (4)
processInstances → process_instances         (5)
  └─ stepExecutions → step_executions
  └─ agentEvents → agent_events
auditEvents → audit_events                   (6)
agentRuns → agent_runs                       (7)
humanTasks → human_tasks                     (8)
handoffEntities → handoff_entities           (9)
coworkSessions → cowork_sessions             (10)
  └─ turns → cowork_turns
namespaceSecrets → workspace_secrets         (11)
workflowSecrets → workflow_secrets           (12)
toolCatalog → tool_catalog                   (13)
oauthProviders → oauth_providers             (14)
agentOauthTokens → agent_oauth_tokens        (15)
cronTriggerState → cron_trigger_state        (16)
modelRegistry → model_registry               (17)
agents → agents                              (18)
```

For each table:

- [ ] **Real run, scoped:**
      ```sh
      python3 main.py --firebase-project=... --database-url=... \
        --only=workspaces --log-file=migration.json
      ```
- [ ] Exit 0; `migration.json` shows expected inserted count
- [ ] **Verify:**
      ```sh
      python3 verify.py --firebase-project=... --database-url=... \
        --only=workspaces
      ```
- [ ] Row counts match Firestore (allowing for documented filtering)
- [ ] Sampled field diff (50 rows) empty
- [ ] Fix any bug discovered → re-run table

Common bug surfaces flagged by the code review (look hard at these):
- `workspace` derivation for sub-collection rows (uses ws_cache from parent namespace)
- `_strip_none_defaults` — ensure DB defaults take over, not NULLs
- `_bool_to_tombstone` for soft-deleted entities
- jsonb roundtrip — re-parses cleanly via Zod after insert
- Timestamps with timezone — Firestore stores UTC; Postgres `timestamptz` expects offset

## 3. Idempotency (~5 min)

Idempotent for tables with natural keys (`workspaces`, `agents`,
`process_instances`, `cowork_sessions`, etc.) — `ON CONFLICT DO NOTHING`
swallows the re-insert.

Tables with synthetic uuid PKs are **not** idempotent:
`audit_events`, `agent_runs`, `human_tasks`, `handoff_entities`. Re-running
duplicates rows. To re-run, `TRUNCATE` those tables first.

- [ ] Re-run `main.py` against now-populated Postgres without `--only`
- [ ] Counts in `migration.json` for natural-key tables must NOT increase
- [ ] No errors
- [ ] If a uuid-PK table needs a re-run: `TRUNCATE <table>;` first, then
      `--only=<table>`

## 4. Smoke test under Postgres backend (~15 min)

```sh
DATABASE_URL='postgresql://mediforce:mediforce@localhost:5432/mediforce' \
  pnpm dev:postgres
```

- [ ] App boots without DATABASE_URL fail-fast
- [ ] `pnpm exec mediforce workflow list` — returns the staging workflows
- [ ] `pnpm exec mediforce tasks list` — returns staging tasks
- [ ] UI loads at http://localhost:9003 with a staging user (admin token)
- [ ] UI reads (`namespaces`, `workflowMeta`, `processInstances`, members,
      audit events) all resolve via REST → Postgres. platform-ui no longer
      reads the Firestore client SDK — confirm the lists populate and refresh
      (react-query polling). Nothing on the UI side blocks the cutover.
- [ ] Server-side audit row appears in `audit_events` table after any mutation
- [ ] No 500s in `/api/*` routes

## 5. Production cutover (only after staging round-trip is clean)

See `PLAN-0001 §8.2` for the maintenance-window procedure. Pre-conditions:

- [ ] Staging cutover repeated end-to-end at least once
- [ ] Operator has Firestore export to GCS (`gcloud firestore export`)
- [ ] Rollback path documented: there is **no** Firestore fallback —
      Postgres is the only backend and the Firestore server data layer is
      deleted. Rollback = re-deploy the previous (pre-migration) container
      image, which reads Firestore again. See Rollback below.

```
1. Announce maintenance window (60 min).
2. Flip app to read-only via flag.
3. `gcloud firestore export gs://mediforce-firestore-backups/<timestamp>`
4. Run main.py against prod Firebase + prod Postgres.
5. Run verify.py. Fix any diff.
6. Deploy the migration build (reads Postgres).
7. Disable read-only flag. Watch error rates 30 min.
```

## Rollback

- This migration deletes the Firestore server data layer; Postgres is the
  only backend after it lands. There is **no** runtime fallback to Firestore.
  Rollback = revert this migration + re-deploy the previous container image
  (which reads Firestore again). Re-running the cutover script later is
  idempotent for natural-key tables, so a second cutover attempt is safe.
- Cutover script: re-running is idempotent for natural-key tables. Bad data
  in a uuid-PK table? TRUNCATE the affected table and re-run with `--only=...`.
- No two-way sync. After cutover, Firestore writes are not picked up.
  Operate read-only until the cutover window closes.
