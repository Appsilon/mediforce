# Cutover Checklist — Firestore → Postgres (ADR-0001)

Operator runbook. Iterative — every phase is observable, reversible, and
re-runnable. Treat this as a dry-run-first discipline: nothing destructive
to production until staging round-trip is clean.

The cutover script (`main.py`) was generated one-shot and is **not unit-tested**.
Bugs are expected. Iterate per-table, fix, re-run, verify.

> **File ownership.** This checklist lives on PR #515. The migration
> script itself (`main.py`, `verify.py`, `requirements.txt`, `README.md`)
> lands with PR #534. While #534 is unmerged, those files do not exist
> on `main`; inspect them on PR #534's branch
> (`claude/hopeful-swartz-51cc72`). Path references in this doc resolve
> correctly once #534 merges.
>
> Pre-cutover host prep (`POSTGRES_PASSWORD` in `/opt/mediforce/.env`,
> bind-mount data dir) lives in
> [`docs/staging-postgres-prep.md`](../../docs/staging-postgres-prep.md).
> Do that before §0 Pre-flight below.

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
- [ ] **Known broken until Phase 2.5:** UI realtime subscriptions
      (`namespaces`, `workflowMeta`, `processInstances`, members, audit events)
      still read from Firestore client SDK. Headless API endpoints + SWR
      hooks land in a separate PR. Do NOT cut prod over before that PR ships.
- [ ] Server-side audit row appears in `audit_events` table after any mutation
- [ ] No 500s in `/api/*` routes

## 5. Production cutover (only after staging round-trip is clean)

See `PLAN-0001 §8.2` for the maintenance-window procedure. Pre-conditions:

- [ ] PR3 (Phase 2.5 — headless endpoints + UI hook migration) merged
- [ ] Staging cutover repeated end-to-end at least once
- [ ] Operator has Firestore export to GCS (`gcloud firestore export`)
- [ ] Rollback path documented: re-deploy previous container image, point
      `DATABASE_URL` empty → falls back to Firestore client SDK reads
      (still alive until Phase 2.6)

```
1. Announce maintenance window (60 min).
2. Flip app to read-only via flag.
3. `gcloud firestore export gs://mediforce-firestore-backups/<timestamp>`
4. Run main.py against prod Firebase + prod Postgres.
5. Run verify.py. Fix any diff.
6. Re-deploy with DATABASE_URL set.
7. Disable read-only flag. Watch error rates 30 min.
```

## Rollback

- Server SDK side: re-deploy previous image (Firestore data layer not yet
  deleted from `main` until PR2 merges). Once PR2 merges, rollback = revert
  PR2 + re-deploy.
- Cutover script: re-running is idempotent. Bad data in Postgres? TRUNCATE
  the affected table and re-run with `--only=...`.
- No two-way sync. After cutover, Firestore writes are not picked up.
  Operate read-only until the cutover window closes.
