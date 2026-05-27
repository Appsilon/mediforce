# Firestore -> Postgres cutover scripts

One-shot data move scripts for the ADR-0001 cutover window. See
[`../../docs/adr/PLAN-0001.md`](../../docs/adr/PLAN-0001.md) §8 for the
operational procedure these scripts plug into.

## Files

- `main.py` — streams Firestore → INSERTs into Postgres (idempotent).
- `verify.py` — per-table row count + 50-row sampled field diff.
- `requirements.txt` — pinned deps.

## Prerequisites

```sh
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/firebase-service-account.json
```

`GOOGLE_APPLICATION_CREDENTIALS` must point at a service-account key with
Firestore read access on the source project.

## Operator procedure (matches PLAN-0001 §8.2)

```
1. Announce maintenance window.
2. Flip app to read-only via feature flag.
3. Snapshot Firestore to GCS (out-of-band: `gcloud firestore export …`).
4. Run main migration:

   python3 main.py \
     --firebase-project=mediforce-prod \
     --database-url="postgresql://user:pass@host:5432/mediforce"

5. Run verification:

   python3 verify.py \
     --firebase-project=mediforce-prod \
     --database-url="postgresql://user:pass@host:5432/mediforce"

   Exits non-zero on any count mismatch or sampled-row diff.

6. Flip STORAGE_BACKEND=postgres in env. Restart app + workers.
7. Smoke test (see PLAN §8.2 step 7).
8. Clear read-only flag.
```

## CLI flags

`main.py`:

| Flag | Default | Notes |
|---|---|---|
| `--firebase-project` | required | Source GCP project id |
| `--database-url` | required | Target Postgres URL |
| `--dry-run` | false | Map + log rows; no INSERT |
| `--only=t1,t2` | all | Restrict to listed table names |
| `--log-file` | `migration_log.json` | Per-table audit JSON |

`verify.py`:

| Flag | Default | Notes |
|---|---|---|
| `--firebase-project` | required | Same as main |
| `--database-url` | required | Same as main |
| `--sample` | 50 | Rows per table to diff |
| `--only=t1,t2` | all | Restrict to listed table names |

## Idempotency

Every INSERT uses `ON CONFLICT DO NOTHING`. Re-running the script is safe:
already-inserted rows are skipped, and the per-table `skipped` counter in
`migration_log.json` records the dedup count.

## Mapping

Firestore collection -> Postgres table mapping is in `main.py` near the top
(`COLLECTION_TABLE_MAP`). Field-name conversion: camelCase -> snake_case;
exact column names match
[`packages/platform-infra/src/postgres/schema/`](../../packages/platform-infra/src/postgres/schema).
