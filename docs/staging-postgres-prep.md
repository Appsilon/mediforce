# Staging Postgres prep — one-off cutover checklist

> **Lifecycle.** This doc covers the one-time host prep on the **existing**
> staging server before PR #515 lands and again before PR #534's data
> cutover. Once the migration succeeds and staging is happily running on
> Postgres, delete this file. Long-term docs for new servers live in
> [`README.md` → Staging / production ops](../README.md#staging--production-ops-postgres)
> (canonical) and `scripts/bootstrap-server.py` (the executable form).

## Why this is a separate doc

`scripts/bootstrap-server.py` is the canonical, idempotent host-prep tool for
**new** deployments. Existing staging was bootstrapped before the Postgres
work, so its `/opt/mediforce/.env` is missing `POSTGRES_PASSWORD` and its
host filesystem is missing `/var/lib/mediforce/postgres-data`. PR #515
makes `platform-ui` hard-depend on `postgres: service_healthy`, so without
this prep the next staging deploy **hangs forever on the healthcheck** and
the app never starts.

Two paths to fix:

- **Path A (recommended): re-run bootstrap.** Updated `bootstrap-server.py`
  reads the existing remote `.env`, hydrates its in-memory state, and only
  generates **missing** values. Safe on a live server. Use this path on
  every other existing deployment too.
- **Path B (fallback): manual ssh + edit.** Documented below for the
  case where re-running bootstrap is somehow not an option.

---

## Path A — re-run bootstrap (idempotent)

`--from-step` takes a 1-based step number (see `scripts/bootstrap-server.py`
`STEPS` list for the ordering). For the Postgres prep, jump to step 10
(`api_keys`) — that step now hydrates from the existing remote `.env`,
generates `POSTGRES_PASSWORD` only if missing, the subsequent `env_local`
step writes it into `/opt/mediforce/.env`, and the new `postgres_dir`
step (13) creates the bind-mount dir with the right ownership.

Dry-run first to see exactly what would change:

```bash
python3 scripts/bootstrap-server.py \
  --host staging.mediforce.example \
  --user deploy \
  --from-step 10 \
  --dry-run
```

Expected dry-run output:

- `[dry-run] would generate POSTGRES_PASSWORD` (only if missing in remote `.env`)
- `[dry-run] would write N + M bytes to the two paths`
- `[dry-run] would mkdir -p /var/lib/mediforce/postgres-data && chown -R 999:999 ...`

Existing managed keys (`PLATFORM_API_KEY`, `SECRETS_ENCRYPTION_KEY`,
`DOCKER_OPENROUTER_API_KEY`) should appear **unchanged** — bootstrap
hydrates them from the remote `.env` before deciding what to generate.
Any unmanaged keys (e.g. operator-added overrides) are preserved verbatim
under a `# Preserved from existing remote .env` section in the
re-rendered file. If the dry-run shows any managed key being regenerated,
**stop** — that's a bug in the hydration step, not a planned change.

Once the dry-run looks right:

```bash
python3 scripts/bootstrap-server.py \
  --host staging.mediforce.example \
  --user deploy \
  --from-step 10
```

Steps that fire:

| # | Step | What happens |
|---|------|---|
| 10 | `api_keys` | Hydrates from remote `.env`, generates `POSTGRES_PASSWORD` only if missing, preserves everything else verbatim |
| 11 | `domain` | "Domain from state: …; Keep using? [Y/n]" — press Enter |
| 12 | `env_local` | Previews merged `.env` (secrets masked), confirms, uploads with 0600 / owned by `deploy` |
| 13 | `postgres_dir` | Idempotent `mkdir -p /var/lib/mediforce/postgres-data` + `chown -R 999:999`; no-op if already correct |
| 14 | `firewall` | UFW status check; no-op if already configured |
| 15 | `first_deploy` | **Triggers full `deploy.sh` on the server (5-15 min docker build).** Abort here if you'd rather let the next CI deploy do it. |

The interactive prompt previews the new `.env` with secrets masked
(`abcd…wxyz (32 chars)`). Confirm the upload.

## Path B — manual ssh + edit (fallback)

```bash
ssh deploy@staging.mediforce.example
```

1. **Generate password + append to compose env file.** Do NOT overwrite the
   file — only append the missing key:

   ```bash
   POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '=+/' | head -c 32)
   echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" >> /opt/mediforce/.env
   echo "$POSTGRES_PASSWORD" > ~/postgres-password.backup  # back this up off-server too
   ```

2. **Create the bind-mount dir with the right ownership** (postgres-alpine
   runs as UID 999):

   ```bash
   sudo mkdir -p /var/lib/mediforce/postgres-data
   sudo chown -R 999:999 /var/lib/mediforce/postgres-data
   ```

3. **Verify** the new `.env` parses and the dir is correct:

   ```bash
   grep -c '^POSTGRES_PASSWORD=' /opt/mediforce/.env   # expect: 1
   ls -ld /var/lib/mediforce/postgres-data             # expect: drwxr-xr-x 999 999
   ```

---

## After PR #515 deploys

PR #515 starts a `postgres` container on staging but the app still reads
from Firestore (`STORAGE_BACKEND` default = `firestore`). Postgres only
holds the `tool_catalog_entries` table at this point — effectively idle.

Smoke-check:

```bash
ssh deploy@staging.mediforce.example
cd /opt/mediforce
docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml ps
# expect: postgres healthy, platform-ui running
docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml \
  exec postgres psql -U mediforce -d mediforce -c '\dt'
# expect: tool_catalog_entries
```

## Data cutover (before PR #534 deploys)

1. **Accept staging data loss in the cut window.** Staging is dev-only; no
   read-only flag needed. Anyone writing to staging Firestore between the
   final migration run and the #534 deploy will lose those writes.

2. **Optional dress rehearsal** — run the migration script locally against
   staging Firestore + a throwaway local Postgres to validate the schema
   conversion before touching staging Postgres.

3. **Run the migration** from your laptop, pointing at staging Postgres.
   See [`scripts/migrate-firestore-to-postgres/README.md`](../scripts/migrate-firestore-to-postgres/README.md)
   for connection details. Staging Postgres is only reachable from inside
   the docker network, so either:
   - SSH-tunnel `5432` to your laptop and run the script locally, or
   - `scp` the script onto the server and run it there.

4. **Verify** with `verify.py` — non-zero exit on any row-count or sampled
   field diff.

5. **Merge PR #534.** Its deploy flips the app to Postgres unconditionally.

## After cutover succeeds

Delete this file in the same PR that drops the `STORAGE_BACKEND` flag
(PLAN-0001 §8.4 cleanup).
