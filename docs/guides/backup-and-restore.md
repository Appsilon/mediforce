---
status: living
audience: operators
last_reviewed: 2026-11-25
---

# Backup and restore

Production keeps everything that matters on one attached Hetzner volume, once
[`move-data-to-volume.md`](move-data-to-volume.md) has been followed on the
host. A nightly [borgmatic](https://torsion.org/borgmatic/) job copies it,
encrypted, to a Hetzner Storage Box. This guide covers setting that up, checking it still
works, and restoring from it.

## What is backed up

| Data | Where | In the archive as |
|---|---|---|
| Postgres: runs, tasks, audit trail, users, encrypted secrets, evaluation data, attachment metadata | `postgres` service | `backup-staging/postgres.dump` (`pg_dump` custom format) |
| Output Files (commits on `run/<runId>` branches, ADR-0015 / ADR-0030) | `/var/lib/mediforce/bare-repos` | objects and refs: one `backup-staging/git-bundles/<namespace>/<name>.bundle` per repo. The rest of the repo (`config` with its remotes, `HEAD`, `info/exclude`): files at the same path |
| Task attachments (`FilesystemBlobStore`, ADR-0003) | `/var/lib/mediforce/attachments` | files at the same path |
| Deployment config | `/opt/mediforce/.env`, `/opt/mediforce/caddy.d` | files at the same path |

These are **not** backed up, because each can be rebuilt or pulled again:
Docker images, per-run worktrees, Redis (in-flight queue only), and Caddy
certificates.

Runs commit to their bare repo while the backup runs, so borg doesn't read the
repos' `objects/` and `refs/` directly. A directory walk can pick up a ref the
moment it moves, while missing the objects it now points to, and that branch
would be broken after a restore. Instead, before borg starts,
[`ops/borgmatic/snapshot.py`](../../ops/borgmatic/snapshot.py) dumps Postgres
and then writes a `git bundle --all` for each repo into
`/var/lib/mediforce/backup-staging`. A bundle reads the refs first and then
packs what they reach, so it is always complete. The dump comes first because a
step's commit is made before the database records its SHA: every commit the
dump names is in a bundle. A repo with no refs yet gets no bundle.

### Hetzner Backups are not the data backup

Hetzner's own server Backups image only the server's disk. **Attached volumes
are excluded**, and volumes have no snapshot feature, so not one row of
Postgres or one Output File is in them. They keep only 7 points, restore only
the whole server, and are deleted with the server. Keep them switched on as a
quick rebuild of the OS and `/opt/mediforce`, nothing more.

## How it runs

The `backup` service in
[`docker-compose.prod.yml`](../../docker-compose.prod.yml) runs the
`ghcr.io/borgmatic-collective/borgmatic` image, configured by
[`ops/borgmatic/config.yaml`](../../ops/borgmatic/config.yaml), whose pre-create
hook runs `snapshot.py`. It has no custom image and no Docker socket.

The staging copy lives in the container's own filesystem only for the length of
a pass and is deleted afterwards, whether the pass succeeds or fails. During a
pass, the host's root disk needs free space for about one dump plus one copy of
the repos.

The schedule is the host crontab, next to the other host jobs:
[`scripts/cron-jobs.py`](../../scripts/cron-jobs.py) installs a `mediforce-backup`
line on every deploy when `.env` sets `BORG_REPO`, and leaves it out otherwise.
At 02:00 host time it runs `borgmatic` inside the `backup` service, which does
create, prune, compact and then the monthly `repository` + `archives` checks.
Output goes to `/opt/mediforce/logs/backup.log`. The image's own cron is off.

- **Retention:** 7 daily, 4 weekly and 6 monthly archives.
- **Encryption:** `repokey-blake2`. The key is stored in the repository and
  locked by `BORG_PASSPHRASE`.
- **Monitoring:** healthchecks.io is pinged on start, success and failure. The
  check's period also catches a night the cron line didn't run or the service
  was down.
- **Off by default.** The service exists only when `.env` has
  `COMPOSE_PROFILES=backup`, and the cron line only when it has `BORG_REPO`.
  Without them, a deploy behaves exactly as before, so forks and staging deploy
  unchanged.

| Variable | Default | Notes |
|---|---|---|
| `COMPOSE_PROFILES` | unset | `backup` turns the service on. |
| `BORG_REPO` | — | Required. `ssh://uNNNNN@uNNNNN.your-storagebox.de:23/./mediforce`. Borg on a Storage Box uses port 23. |
| `BORG_PASSPHRASE` | — | Required. Also stored in the password manager. Without it, no archive can be read. |
| `BACKUP_PING_URL` | — | Required. The healthchecks.io ping URL. If it's unset, the backup still runs, but every ping fails and nothing reports a missed night. |
| `BACKUP_NAME` | `mediforce` | Archive name prefix. `latest`, prune and checks only see archives with it, so two deployments sharing one repository need different names. |
| `BACKUP_SSH_KEY_PATH` | `/home/deploy/.ssh/backup_key` | Private key the Storage Box accepts. |
| `BACKUP_KNOWN_HOSTS_PATH` | `/home/deploy/.ssh/backup_known_hosts` | The Storage Box's host key. An unknown host fails the backup instead of trusting it. |
| `BACKUP_MEM_LIMIT` | `512m` | Container memory limit. |

The image ships `pg_dump` 18. Its archives can't be read by `pg_restore` 16,
and its `pg_restore` sends settings that Postgres 16 rejects. The service
therefore installs `postgresql16-client` (and `git`) at start (`EXTRA_PKGS`),
and `snapshot.py` calls those binaries by path (`PG_BIN`). **A Postgres major
upgrade changes both `EXTRA_PKGS` and `PG_BIN`.** If the package fails to
install, the backup fails loudly rather than falling back to v18.

Run every manual command from `/opt/mediforce` as `deploy`, with this set once
per shell:

```bash
cd /opt/mediforce
COMPOSE="docker compose -f docker-compose.prod.yml"
```

Use `$COMPOSE exec backup …` rather than `run`: only the running service has
the v16 client and `git` that its init installs. The restore's one-off
containers are the exception. They need writable mounts, and the one that
needs the packages installs them itself.

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
   $COMPOSE up -d backup
   $COMPOSE exec backup borgmatic repo-create
   ```

   The encryption mode, `repokey-blake2`, comes from the config.

4. **Export the repository key** and store it in the password manager next to
   the passphrase. The key also lives inside the repository, but a damaged
   repository can't then be opened without the exported copy.

   ```bash
   $COMPOSE exec backup borgmatic key export
   ```

5. **First backup, by hand:** `$COMPOSE exec backup borgmatic --stats -v 1`,
   then `$COMPOSE exec backup borgmatic repo-list`.

6. **healthchecks.io.** Set the check's period to 1 day and its grace to 2
   hours, with email to the ops list. Stopping the `backup` service for a day
   must send that email. Test it once.

7. **Schedule.** Run `python3 scripts/cron-jobs.py install` (or deploy), then
   check that `crontab -l` has a `# mediforce-backup` line.

Later deploys need nothing extra: `scripts/deploy.sh` runs `docker compose up`,
which reads `COMPOSE_PROFILES` from `.env`, and reinstalls the crontab.

## Day to day

| Task | Command |
|---|---|
| List archives | `$COMPOSE exec backup borgmatic repo-list` |
| List files in the latest archive | `$COMPOSE exec backup borgmatic list --archive latest` |
| Back up now | `$COMPOSE exec backup borgmatic --stats -v 1` |
| See what ran overnight | `tail -n 50 logs/backup.log` |
| Repository size | `$COMPOSE exec backup borgmatic repo-info` |

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
archive, so it's no help without the passphrase. That also means the passphrase
alone opens every production secret: keep it only in the password manager and
the host's `.env`.

## Restore

The steps are the same for a real recovery and for the drill. The drill must
never write to the production repository. Nothing is scheduled until step 7's
deploy installs the crontab, and the drill blanks `BORG_REPO` before that.
Otherwise the drill server would back itself up into the production repository
every night, and its prune would run there.

1. **Server.** Bring up a host with `scripts/bootstrap-server.py`, or check out
   the release into `/opt/mediforce` by hand. If bootstrap already started the
   stack, run `$COMPOSE down -v` first. Postgres initialised with bootstrap's
   generated password, and step 4 brings back production's. A fresh host has
   nothing in those volumes to lose. Step 4's extract creates
   `/var/lib/mediforce/{bare-repos,attachments,backup-staging}`.
2. **SSH access to the Storage Box** for this host's key, as in setup step 1.
3. **Minimal `.env`:** `COMPOSE_PROFILES=backup`, `BORG_REPO`,
   `BORG_PASSPHRASE`, `BACKUP_PING_URL=` (empty for a drill),
   `POSTGRES_PASSWORD` (any value for now) and `BACKUP_NAME` if production
   sets one.
4. **Restore the files.** A one-off container gets a writable mount, because the
   service's own source mounts are read-only:

   ```bash
   $COMPOSE run --rm --no-deps \
     --entrypoint borgmatic -v /var/lib/mediforce:/restore backup \
     extract --archive latest \
       --path var/lib/mediforce/bare-repos --path var/lib/mediforce/attachments \
       --path var/lib/mediforce/backup-staging \
       --destination /restore --strip-components 3

   $COMPOSE run --rm --no-deps \
     --entrypoint borgmatic -v /opt/mediforce:/restore backup \
     extract --archive latest \
       --path opt/mediforce/.env --path opt/mediforce/caddy.d \
       --destination /restore --strip-components 2
   ```

   This replaces `.env` with the production one. **For a drill**, blank
   `BACKUP_PING_URL` and change `DOMAIN` and `NEXT_PUBLIC_APP_URL` to the drill
   host. Leave `BORG_REPO` until step 5 is done.
5. **Rebuild the repos and restore Postgres.** `snapshot.py restore` fetches
   each bundle into its repo's extracted skeleton and gives the files that
   repo's owner. It then runs `pg_restore --clean --if-exists` into
   `POSTGRES_DB` and deletes `/var/lib/mediforce/backup-staging`. The one-off
   container installs the `EXTRA_PKGS` itself, because the image's init (which
   normally installs them) doesn't run with a custom entrypoint.

   ```bash
   $COMPOSE up -d postgres
   $COMPOSE run --rm --no-deps --entrypoint sh -v /var/lib/mediforce:/restore backup \
     -c 'apk add -q --no-cache $EXTRA_PKGS && python3 /etc/borgmatic/snapshot.py restore /restore'
   ```

6. **For a drill, blank `BORG_REPO` in `.env` now.** The deploy then installs
   no backup cron line, and the recreated `backup` service can't reach the
   repository.
7. **Start everything:** `scripts/deploy.sh <version>`, using the version from
   the restored `.env`'s `MEDIFORCE_VERSION`. The `migrate` container applies
   any migration newer than the dump. On a drill host, `crontab -l` must show
   no `# mediforce-backup` line.
8. **After a drill**, remove the drill host's key from the Storage Box's
   `.ssh/authorized_keys` before tearing the server down.

### Checking a restore

- Row counts match the source. Run this on both hosts:

  ```bash
  $COMPOSE exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
  select
    (select count(*) from process_instances) runs,
    (select count(*) from human_tasks) tasks,
    (select count(*) from audit_events) audit,
    (select count(*) from task_attachments) attachments,
    (select count(*) from auth_users) users;
  SQL
  ```

- An old run's page lists its Output Files, and one of them opens.
- One task attachment downloads.
- One workflow secret decrypts. A run that uses it gets past the step.

## Restore drill log

| Date | Archive | Who | Result |
|---|---|---|---|
| — | — | — | Not yet run. |
