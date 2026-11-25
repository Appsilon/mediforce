---
status: living
audience: operators
last_reviewed: 2026-11-25
---

# Backup and restore

Production keeps everything that matters on one attached Hetzner volume. A
nightly [borgmatic](https://torsion.org/borgmatic/) job copies it, encrypted, to
a Hetzner Storage Box. This guide covers setting that up, checking it still
works, and restoring from it.

## What is backed up

| Data | Where | In the archive as |
|---|---|---|
| Postgres: runs, tasks, audit trail, users, encrypted secrets, evaluation data, attachment metadata | `postgres` service | `pg_dump` custom format, streamed in by the `postgresql_databases` hook |
| Output Files (commits on `run/<runId>` branches, ADR-0015 / ADR-0030) | `/var/lib/mediforce/bare-repos` | files at the same path |
| Task attachments (`FilesystemBlobStore`, ADR-0003) | `/var/lib/mediforce/attachments` | files at the same path |
| Deployment config | `/opt/mediforce/.env`, `/opt/mediforce/caddy.d` | files at the same path |

These are **not** backed up, because each can be rebuilt or pulled again:
Docker images, per-run worktrees, Redis (in-flight queue only), and Caddy
certificates.

`pg_dump` takes its snapshot before borg reads the files. Run branches only gain
commits, so the files always hold every commit the dump refers to.

### Hetzner Backups are not the data backup

Hetzner's own server Backups image only the server's disk. **Attached volumes
are excluded**, and volumes have no snapshot feature, so not one row of
Postgres or one Output File is in them. They keep only 7 points, restore only
the whole server, and are deleted with the server. Keep them switched on as a
quick rebuild of the OS and `/opt/mediforce`, nothing more.

## How it runs

The `backup` service in
[`docker-compose.prod.yml`](../../docker-compose.prod.yml) runs the
`ghcr.io/borgmatic-collective/borgmatic` image, configured entirely by
[`ops/borgmatic/config.yaml`](../../ops/borgmatic/config.yaml). It has no custom
image, no custom script and no Docker socket. Its built-in cron runs one
borgmatic pass a night, which does create, prune, compact and then the monthly
`repository` + `archives` checks.

- **Retention:** 7 daily, 4 weekly and 6 monthly archives.
- **Encryption:** `repokey-blake2`. The key is stored in the repository and
  locked by `BORG_PASSPHRASE`.
- **Monitoring:** healthchecks.io is pinged on start, success and failure. The
  check's period also catches a scheduler that stopped running.
- **Off by default.** The service exists only when `.env` has
  `COMPOSE_PROFILES=backup`. Without it, `docker compose up` behaves exactly as
  before, so forks and staging deploy unchanged.

| Variable | Default | Notes |
|---|---|---|
| `COMPOSE_PROFILES` | unset | `backup` turns the service on. |
| `BORG_REPO` | — | Required. `ssh://uNNNNN@uNNNNN.your-storagebox.de:23/./mediforce`. Borg on a Storage Box uses port 23. |
| `BORG_PASSPHRASE` | — | Required. Also stored in the password manager. Without it, no archive can be read. |
| `BACKUP_PING_URL` | — | Required. The healthchecks.io ping URL. If it's unset, the backup still runs, but every ping fails and nothing reports a missed night. |
| `BACKUP_CRON` | `0 2 * * *` | Cron schedule, in UTC. `false` disables the schedule; the restore drill needs that. |
| `BACKUP_SSH_KEY_PATH` | `/home/deploy/.ssh/backup_key` | Private key the Storage Box accepts. |
| `BACKUP_KNOWN_HOSTS_PATH` | `/home/deploy/.ssh/backup_known_hosts` | The Storage Box's host key. An unknown host fails the backup instead of trusting it. |
| `BACKUP_MEM_LIMIT` | `512m` | Container memory limit. |

The image ships `pg_dump` 18. Its archives can't be read by `pg_restore` 16,
and its `pg_restore` sends settings that Postgres 16 rejects. The service
therefore installs `postgresql16-client` at start (`EXTRA_PKGS`), and the config
calls those binaries by path. **A Postgres major upgrade changes both
`EXTRA_PKGS` and the three `*_command` paths in the config.** If the package
fails to install, the backup fails loudly rather than falling back to v18.

Run every manual command from `/opt/mediforce` as `deploy`. Use
`docker compose -f docker-compose.prod.yml exec backup …` rather than `run`:
the image's init doesn't pass the container env to a `run` command. The
examples below shorten that to `dc exec backup …`.

## One-time setup

1. **Storage Box.** In the Hetzner console, turn on SSH support for the box.
   Create a key on the server and upload it:

   ```bash
   ssh-keygen -t ed25519 -N '' -f ~/.ssh/backup_key -C mediforce-backup
   cat ~/.ssh/backup_key.pub | ssh -p 23 uNNNNN@uNNNNN.your-storagebox.de install-ssh-key
   ssh-keyscan -p 23 uNNNNN.your-storagebox.de > ~/.ssh/backup_known_hosts
   ```

2. **`.env`.** Add `COMPOSE_PROFILES=backup`, `BORG_REPO`, `BORG_PASSPHRASE`
   (`openssl rand -base64 48`) and `BACKUP_PING_URL`. Put the passphrase in
   the password manager now, not later.

3. **Start it and create the repository.**

   ```bash
   docker compose -f docker-compose.prod.yml up -d backup
   dc exec backup borgmatic repo-create --encryption repokey-blake2
   ```

4. **Export the repository key** and store it in the password manager next to
   the passphrase. The key also lives inside the repository, but a damaged
   repository can't then be opened without the exported copy.

   ```bash
   dc exec backup borgmatic key export
   ```

5. **First backup, by hand:** `dc exec backup borgmatic --stats -v 1`, then
   `dc exec backup borgmatic list`.

6. **healthchecks.io.** Set the check's period to 1 day and its grace to 2
   hours, with email to the ops list. Stopping the `backup` service for a day
   must send that email. Test it once.

Later deploys need nothing extra: `scripts/deploy.sh` runs `docker compose up`,
which reads `COMPOSE_PROFILES` from `.env`.

## Day to day

| Task | Command |
|---|---|
| List archives | `dc exec backup borgmatic list` |
| Back up now | `dc exec backup borgmatic --stats -v 1` |
| See what ran overnight | `dc logs --since 24h backup` |
| Repository size | `dc exec backup borgmatic repo-info` |

## Secrets a restore needs from outside the host

The host may be gone, so all of these live in the password manager:

| Secret | Why |
|---|---|
| `BORG_PASSPHRASE` | Opens the repository. Without it, the backup is unreadable. |
| Exported borg repo key | Opens the repository if its own copy of the key is damaged. |
| Storage Box credentials | Upload a new server's SSH key. |
| `SECRETS_ENCRYPTION_KEY` | Without it, the restored workflow and workspace secrets can't be decrypted. |
| `AUTH_SECRET` | Keeps existing sessions and signed links valid. |
| `POSTGRES_PASSWORD` | The restored `.env` carries it too. Keep a copy anyway. |

The restored `.env` holds all of these as well, but it's encrypted inside the
archive, so it's no help without the passphrase.

## Restore

The steps are the same for a real recovery and for the drill. The drill must
never write to the production repository, so it sets `BACKUP_CRON=false`. With
the schedule on, the drill server would back itself up into the production
repository and its prune would run there.

1. **Server.** Bring up a host with `scripts/bootstrap-server.py`, or check out
   the release into `/opt/mediforce` by hand and create
   `/var/lib/mediforce/{bare-repos,attachments}`. If bootstrap already
   started the stack, run `docker compose -f docker-compose.prod.yml down -v`
   first. Postgres initialised with bootstrap's generated password, and step 4
   brings back production's. A fresh host has nothing in those volumes to lose.
2. **SSH access to the Storage Box** for this host's key, as in setup step 1.
3. **Minimal `.env`:** `COMPOSE_PROFILES=backup`, `BORG_REPO`,
   `BORG_PASSPHRASE`, `BACKUP_PING_URL=` (empty for a drill),
   `BACKUP_CRON=false` and `POSTGRES_PASSWORD` (any value for now).
4. **Restore the files.** A one-off container gets a writable mount, because the
   service's own source mounts are read-only:

   ```bash
   docker compose -f docker-compose.prod.yml run --rm --no-deps \
     --entrypoint borgmatic -v /var/lib/mediforce:/restore backup \
     extract --archive latest \
       --path var/lib/mediforce/bare-repos --path var/lib/mediforce/attachments \
       --destination /restore --strip-components 3

   docker compose -f docker-compose.prod.yml run --rm --no-deps \
     --entrypoint borgmatic -v /opt/mediforce:/restore backup \
     extract --archive latest \
       --path opt/mediforce/.env --path opt/mediforce/caddy.d \
       --destination /restore --strip-components 2
   ```

   This replaces `.env` with the production one. **For a drill**, add
   `BACKUP_CRON=false` to it again and blank `BACKUP_PING_URL`, then change
   `DOMAIN` and `NEXT_PUBLIC_APP_URL` to the drill host.
5. **Restore Postgres.** `up -d backup` starts only `postgres` and `backup`.
   The restore is `pg_restore --clean --if-exists` into `POSTGRES_DB`.

   ```bash
   docker compose -f docker-compose.prod.yml up -d backup
   dc exec backup borgmatic restore --archive latest
   ```

6. **Start everything:** `scripts/deploy.sh <version>`, using the version from
   the restored `.env`'s `MEDIFORCE_VERSION`. The `migrate` container applies
   any migration newer than the dump.

### Checking a restore

- Row counts match the source. Run this on both hosts:

  ```bash
  dc exec postgres psql -U mediforce -c "select
    (select count(*) from process_instances) runs,
    (select count(*) from human_tasks) tasks,
    (select count(*) from audit_events) audit,
    (select count(*) from task_attachments) attachments,
    (select count(*) from auth_users) users"
  ```

- An old run's page lists its Output Files, and one of them opens.
- One task attachment downloads.
- One workflow secret decrypts. A run that uses it gets past the step.

## Restore drill log

| Date | Archive | Who | Result |
|---|---|---|---|
| — | — | — | Not yet run. The first drill is part of #1683's acceptance. |
