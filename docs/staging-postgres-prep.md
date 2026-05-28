# Staging Postgres prep — one-off cutover checklist

> **Lifecycle.** One-off host prep on the **existing** staging server
> before PR #515 lands. Delete this file after the ADR-0001 cutover
> succeeds. Long-term ops content for fresh server provisioning lives
> in `scripts/bootstrap-server.py` + [`README.md`](../README.md#staging--production-ops-postgres).

## Why this is needed

`scripts/bootstrap-server.py` is the canonical fresh-server provisioner
— it auto-generates `POSTGRES_PASSWORD` and creates the bind-mount data
dir as part of its first run on a new host. Existing staging was
bootstrapped before the Postgres work, so:

- `/opt/mediforce/.env` is missing `POSTGRES_PASSWORD`
- `/var/lib/mediforce/postgres-data` does not exist on the host

PR #515 makes `platform-ui` hard-depend on `postgres: service_healthy`.
Without prep, the next staging deploy **hangs forever on the
healthcheck** and the app never starts.

Bootstrap is **not** re-run against existing servers — that flow isn't
implemented today. Existing staging gets manual ssh prep.

## Manual prep (existing staging, one-off)

```bash
ssh deploy@mediforce-staging
```

### 1. Backup the existing compose env (insurance)

```bash
cp -p /opt/mediforce/.env /opt/mediforce/.env.bak-$(date -u +%Y%m%dT%H%M%SZ)
ls -lt /opt/mediforce/.env*
```

### 2. Append `POSTGRES_PASSWORD` to compose env

Generate a strong password locally, append the line — **do NOT
overwrite the file** (preserves all existing keys):

```bash
POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '=+/' | head -c 32)
echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" >> /opt/mediforce/.env
echo "$POSTGRES_PASSWORD" > ~/postgres-password.backup   # also save off-server
```

### 3. Create the bind-mount data dir (postgres-alpine runs as UID 999)

```bash
sudo mkdir -p /var/lib/mediforce/postgres-data
sudo chown -R 999:999 /var/lib/mediforce/postgres-data
```

### 4. Verify

```bash
grep -c '^POSTGRES_PASSWORD=' /opt/mediforce/.env   # expect: 1
ls -ld /var/lib/mediforce/postgres-data             # expect: drwxr-xr-x 999 999
cd /opt/mediforce && docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml config 2>/dev/null | grep -A 1 POSTGRES_PASSWORD | head -4
# expect: line shows non-empty POSTGRES_PASSWORD substitution
```

---

## After PR #515 deploys

PR #515 starts a `postgres` container on staging but the app still reads
from Firestore (`STORAGE_BACKEND` default = `firestore`). Postgres only
holds the `tool_catalog_entries` table at this point — effectively idle.

Smoke-check:

```bash
ssh deploy@mediforce-staging
cd /opt/mediforce
docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml ps
# expect: postgres healthy, platform-ui running
docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml \
  exec postgres psql -U mediforce -d mediforce -c '\dt'
# expect: tool_catalog_entries
```

## Data cutover (before PR #534 deploys)

The detailed operator runbook for the actual migration lives in
[`scripts/migrate-firestore-to-postgres/CUTOVER-CHECKLIST.md`](../scripts/migrate-firestore-to-postgres/CUTOVER-CHECKLIST.md).
Follow it once host prep above is done. Staging-specific deltas:

1. **Accept staging data loss in the cut window.** Staging is dev-only; no
   read-only flag needed. Anyone writing to staging Firestore between the
   final migration run and the #534 deploy will lose those writes.

2. **Reachability.** Staging Postgres is only reachable from inside the
   docker network, so for `main.py` / `verify.py` either:
   - SSH-tunnel `5432` to your laptop and run the script locally, or
   - `scp` the script onto the server and run it there.

3. **Merge PR #534** once `verify.py` exits 0. Its deploy flips the app
   to Postgres unconditionally.

## After cutover succeeds

Delete this file in the same PR that drops the `STORAGE_BACKEND` flag
(PLAN-0001 §8.4 cleanup).
