---
status: living
audience: operators
last_reviewed: 2026-11-26
---

# Move Postgres from the named volume to the bind mount

Up to v1.4.2, `docker-compose.prod.yml` kept Postgres in the named volume
`postgres-data`, and `docker compose down -v` deleted it along with the whole
database. Newer releases bind-mount `/var/lib/mediforce/postgres-data`, as
staging already did, so only an explicit `rm -rf` removes the data.

Every server bootstrapped before that change has its database in the volume and
an empty `/var/lib/mediforce/postgres-data` next to it. A deploy onto that host
would start Postgres on the empty directory and serve a blank platform without
any error, so `scripts/deploy.sh` refuses to deploy until the data has moved:

```
ERROR: Postgres data is still in the named volume postgres-data and /var/lib/mediforce/postgres-data is empty.
```

Run the steps below once per host. They take a few minutes of downtime. A server
bootstrapped after the change never has the volume and needs none of this.

All commands run as `deploy` in `/opt/mediforce`. That user has no sudo, so the
file operations go through a root `alpine` container. The volume name assumes the
compose project is `mediforce` (the directory name). Check with `docker volume ls`.

## 1. Before the downtime

Confirm the Hetzner volume is mounted if the host has one. `/var/lib/mediforce`
and `/var/lib/docker` are `nofail` bind mounts from it, and without it both come
up empty on the root disk:

```bash
findmnt -T /var/lib/mediforce
```

If the host runs the `backup` profile, take an off-host backup now and check it
reached the repository
([backup-and-restore.md](backup-and-restore.md#day-to-day)):

```bash
COMPOSE="docker compose -f docker-compose.prod.yml"
$COMPOSE exec backup borgmatic --stats -v 1
$COMPOSE exec backup borgmatic repo-list | tail -n 1
```

Take a local dump too, and write the row-count query:

```bash
docker exec mediforce-postgres-1 pg_dump -U mediforce -Fc mediforce > ~/pre-bind-mount.dump

cat > ~/row-counts.sql <<'SQL'
SELECT table_name,
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY 1;
SQL
```

## 2. Stop writers, then Postgres

```bash
$COMPOSE stop platform-ui container-worker
docker exec -i mediforce-postgres-1 psql -U mediforce -d mediforce -At < ~/row-counts.sql > ~/row-counts-before.txt
$COMPOSE stop postgres
```

The counts are taken after the writers stop, so the comparison in step 5 must
match exactly.

## 3. Copy the data

```bash
docker run --rm \
  -v mediforce_postgres-data:/from:ro \
  -v /var/lib/mediforce/postgres-data:/to \
  alpine:latest sh -c 'ls -A /to | grep -q . && echo "target not empty" && exit 1; cp -a /from/. /to/'
```

`cp -a` keeps the owner (uid 70, the postgres user in `postgres:16-alpine`) and
the `0700` mode. On hosts that share a disk between `/var/lib/docker` and
`/var/lib/mediforce`, the copy needs as much free space as the database
(`du -sh` it first if the disk is tight).

## 4. Deploy the release that has the bind mount

Production: **Actions → Deploy to Production → Run workflow** with that version.
The guard now finds `PG_VERSION` in the bind directory and the deploy goes ahead.

## 5. Compare

```bash
docker exec -i mediforce-postgres-1 psql -U mediforce -d mediforce -At < ~/row-counts.sql > ~/row-counts-after.txt
diff ~/row-counts-before.txt ~/row-counts-after.txt && echo MATCH
docker inspect mediforce-postgres-1 --format '{{json .Mounts}}'
```

The mount must show `"Type":"bind"` with source `/var/lib/mediforce/postgres-data`.
New writes after the deploy can raise counts, so diff right away.

## 6. Remove the old volume

Archive the volume, then delete it in the same session:

```bash
docker run --rm -v mediforce_postgres-data:/from:ro -v /var/lib/mediforce:/out \
  alpine:latest tar -czf /out/postgres-data-pre-bind-mount.tar.gz -C /from .
docker volume rm mediforce_postgres-data
```

Don't leave the volume in place as a fallback. A rollback to v1.4.2 or older
would mount it again and serve the stale copy as the live database, while the
writes made since the migration sit unused in the bind directory. With the
volume gone, such a rollback starts on an empty database instead. That is
obvious and does no harm: deploy forward again and the data is back.

Delete the tarball and `~/pre-bind-mount.dump` after a week.

## Undo

If step 5 doesn't match, stop the stack, empty the bind directory, and deploy
v1.4.2 again. It mounts the untouched volume:

```bash
docker compose -f docker-compose.prod.yml down    # never -v
docker run --rm -v /var/lib/mediforce:/host alpine:latest \
  sh -c 'rm -rf /host/postgres-data && mkdir /host/postgres-data && chown 999:999 /host/postgres-data'
```
