---
status: living
audience: operators
last_reviewed: 2026-11-27
---

# Redis capacity and recovery

Redis carries every container job between the platform and the worker. When it
fills, it does not slow down — it stops accepting writes, and every agent and
script step stops with it. This is how it is bounded, what warns you before it
happens, and how to recover it without making things worse.

## Two limits, and why they differ

| Setting | Production default | Staging default | Who enforces it |
|---|---|---|---|
| `REDIS_MEM_LIMIT` | `1g` | `256m` | the kernel — crossing it is a SIGKILL |
| `REDIS_MAX_MEMORY` | `640mb` | `160mb` | Redis — crossing it is a refused write |

Both live in [`docker-compose.prod.yml`](../../docker-compose.prod.yml), with
staging's smaller pair in
[`docker-compose.staging.yml`](../../docker-compose.staging.yml). Neither needs
to be set for a deployment to work; override them in `.env` only to move a host
off the defaults.

`REDIS_MAX_MEMORY` deliberately sits well below `REDIS_MEM_LIMIT`. The gap is
headroom for the RDB background save, which forks and copies pages as they
change — a Redis sitting at its container limit is killed part-way through that
copy, which is precisely what happened on 2026-09-15. Under the lower limit you
instead get `OOM command not allowed` on one enqueue, which fails one step and
leaves everything else running.

The policy is `noeviction`. BullMQ jobs are work in flight, not cache: evicting
one loses a step's result silently, which is worse than failing loudly. For the
same reason, never turn off `stop-writes-on-bgsave-error` — it is what converts
"snapshots have been failing for a week" into an error someone sees.

## What keeps Redis small

Two mechanisms, both in
[`packages/container-worker`](../../packages/container-worker/README.md):

- **Bulk payloads travel beside the job.** Workspace files, an oversized prompt,
  and oversized stdout/stderr go into their own short-lived Redis keys rather
  than into job data or a return value, because BullMQ retains those in the job
  hash *and* again in the `completed` event. The caller deletes the keys when
  the job settles; a TTL covers a caller that died waiting.
- **Retention is bounded by age and count.** 10 completed jobs for an hour, 20
  failed for a day, and the events stream capped at 100 entries against
  BullMQ's default of 10,000.

A job whose remaining data still exceeds `JOB_DATA_MAX_BYTES` (256 KiB) is
rejected before it reaches Redis. If you see that error, something new is being
carried inside the job that belongs beside it.

Because payloads travel by key, **the worker must never lag the platform**: a
worker one release behind drops the key fields it does not know and runs the
container with no prompt, exiting 0 rather than failing. Both deploy scripts
bring `container-worker` up in its own `up -d` ahead of the rest for exactly
this reason. If you ever start services by hand, do the same.

## What warns you

Servers with the `monitoring` service run these checks as Grafana Cloud alerts,
which mail the ops list even when the host is down. Each alert's runbook is in
[monitoring.md](monitoring.md#alerts).

| What fails | Alert |
|---|---|
| RDB snapshots | [Redis snapshot failing](monitoring.md#redis-snapshot-failing) (`redis_rdb_last_bgsave_status`) |
| Redis memory vs `maxmemory` | [Redis memory high](monitoring.md#redis-memory-high), above 85% |
| Redis restarts or is killed | [Container restarting](monitoring.md#container-restarting), [OOM kill](monitoring.md#oom-kill), [Redis down](monitoring.md#redis-down) |
| Host disk | [Filesystem full](monitoring.md#filesystem-full) at 75% / 85%, [Filesystem predicted full](monitoring.md#filesystem-predicted-full) within 7 days |

Orphaned `temp-*.rdb` snapshots have no alert of their own: what they do is
fill the disk, which the filesystem alerts catch. Step 2 of
[Recovery](#recovery) removes them.

To see the same state by hand on a host (`<redis>` is the Redis container,
`docker ps --filter label=com.docker.compose.service=redis`):

```bash
docker exec <redis> redis-cli info persistence | grep rdb_last_bgsave_status
docker exec <redis> redis-cli info memory | grep -E '^(used_memory|maxmemory):'
docker inspect -f '{{.RestartCount}} {{.State.OOMKilled}}' <redis>
docker exec <redis> ls -la /data
df -h /
```

Staging's Redis requires a password: pass it as
`docker exec -e REDISCLI_AUTH=<REDIS_PASSWORD from /opt/mediforce/.env> <redis> redis-cli …`.

## Recovery

When Redis is refusing writes (`MISCONF Errors writing to the RDB snapshot`):

1. **Find out why the save failed.** Almost always disk:
   `df -h /` and `docker exec <redis> ls -la /data`.
2. **Remove only failed snapshots.** `temp-*.rdb` files are saves that were
   killed part-way; each is dead weight. **Never delete `dump.rdb`** — it is the
   last good snapshot and the only copy of the queue if Redis restarts.
3. **Reclaim host disk** with `docker image prune -f` and
   `docker builder prune -f --keep-storage=5GB` — the same conservative pair the
   deploy runs.
4. **Give Redis room** if it is genuinely at its ceiling: raise
   `REDIS_MEM_LIMIT` and `REDIS_MAX_MEMORY` together in `.env`, keeping the
   ~62% ratio, then `docker compose -f docker-compose.prod.yml up -d redis` — on staging add
   `-f docker-compose.staging.yml`, or Redis comes back without `--requirepass`
   behind a published tunnel port.
5. **Force a save and confirm it worked:** `docker exec <redis> redis-cli bgsave`,
   then check `rdb_last_bgsave_status:ok` in `redis-cli info persistence`.
   Writes resume on their own once a save succeeds.
6. **Re-run the checks** under [What warns you](#what-warns-you) and confirm
   the alerts resolve.

What not to do, in any order of desperation: do not delete `dump.rdb`, do not
set `stop-writes-on-bgsave-error no`, and do not switch `maxmemory-policy` to an
evicting policy. Each one turns a visible outage into silent data loss.

## Docker artifact retention

A successful deploy prunes conservatively — [`scripts/deploy.sh`](../../scripts/deploy.sh)
removes old release tags, then runs `docker image prune -f` and
`docker builder prune -f --keep-storage=5GB` after the agent images rebuild.
All three are deliberately narrow:

- On a versioned deploy, only the two newest `X.Y.Z` tags of each platform
  image (`platform-ui`, `migrate`, `container-worker`) stay on the host, plus
  the running version. `latest` and other tags are never touched, and the step
  is skipped for `latest` deploys. Rolling back to the previous release needs
  no registry pull; anything older is pulled from GHCR first.
- `image prune -f` removes only **dangling** images — layers orphaned by a
  rebuild or by the tag removal above.
- `--keep-storage=5GB` keeps the layer cache that makes the next agent-image
  build fast. Evicting it wholesale is what made staging deploys time out, which
  is why [`scripts/deploy-staging.sh`](../../scripts/deploy-staging.sh) does the
  aggressive `builder prune -af` only above 80% disk.

The Docker daemon itself is capped by the `docker_gc` step of
[`scripts/bootstrap-server.py`](../../scripts/bootstrap-server.py), which merges
two settings into `/etc/docker/daemon.json`:

- `"log-driver": "local"` — container logs are compressed and rotated
  (5 × 20 MB per container) instead of growing forever under `json-file`.
  A container switches driver only when it is recreated, which the next deploy
  does.
- A 10 GB BuildKit GC cap (`builder.gc.defaultKeepStorage`).

The step restarts Docker only when the file changed, so re-running it is a
no-op on a configured host. To apply it to an existing host, run
`python3 scripts/bootstrap-server.py --host <host> --only-step docker_gc` in a quiet window (the
restart is a short outage), then deploy, and check that
`docker info --format '{{.LoggingDriver}}'` prints `local`.

The [filesystem alerts](monitoring.md#filesystem-full) are the backstop: if
artifacts still accumulate past 75%, they tell you before a snapshot fails.
