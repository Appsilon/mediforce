---
status: living
audience: operators
last_reviewed: 2026-11-26
---

# Monitoring and alerting

Each server sends metrics to a Grafana Cloud stack. The alert rules run there,
off the box, so a dead server still alerts. Every alert emails the **ops
mailing list**. Hetzner's console graphs CPU and network only, with no
disk-space metric and no alerts.

Three things watch a server, each from outside it:

| What | Catches | Where it is set up |
|---|---|---|
| Grafana Alloy → Grafana Cloud alert rules | full disk, low memory, OOM kills, restart loops, Postgres and Redis trouble, a host that stopped reporting | [`ops/alloy/config.alloy`](../../ops/alloy/config.alloy), [`ops/grafana/alert-rules.yaml`](../../ops/grafana/alert-rules.yaml) |
| Grafana Cloud Synthetic Monitoring | the public URL is unreachable, or its TLS certificate expires soon | the Grafana Cloud UI, once per domain |
| healthchecks.io heartbeat check | the platform's clock stopped: the heartbeat cron isn't running, or `/api/cron/heartbeat` fails | [`scripts/heartbeat.py`](../../scripts/heartbeat.py) |

**Recipients.** Each tool notifies the ops mailing list's address, and nothing
else: it is the Grafana email contact point and the healthchecks.io email
integration. To add or remove a person, change the membership in the list's own
admin, where the list is hosted. No tool's configuration changes.

## How it runs

The `monitoring` service in
[`docker-compose.prod.yml`](../../docker-compose.prod.yml) runs the
`grafana/alloy` image with
[`ops/alloy/config.alloy`](../../ops/alloy/config.alloy). It uses only Alloy's
built-in exporters, with no custom ones:

- `prometheus.exporter.unix`: every filesystem (the root disk and the attached
  volume), memory, load, and the kernel's OOM-kill counter. It reads the host
  through read-only mounts of `/proc`, `/sys` and `/`.
- `prometheus.exporter.cadvisor`: memory against `mem_limit`, CPU, and start
  times for each compose service. It uses the read-only Docker and containerd
  sockets. Agent containers are dropped, which keeps the series count inside the
  free tier.
- `prometheus.exporter.postgres` and `prometheus.exporter.redis`, which connect
  over the compose network.

Alloy scrapes every 60 seconds. Every series is labelled
`instance=<DOMAIN>`, so staging and production can share one stack. A server
sends about 2,000 series, and the free tier allows 10,000. Postgres and Redis
pass through a keep-list: their exporters emit a series per table, setting and
command, which alone came to about 2,900 on staging. To use another of their
metrics, add it to the `keep` rule in `config.alloy`.

**Container logs are never shipped.** They can contain clinical or personal
content. Only numeric metrics leave the server.

**Off by default.** The service exists only when `.env` has `monitoring` in
`COMPOSE_PROFILES`. Without it, a deploy behaves exactly as before, so forks
deploy unchanged. `deploy.sh` and `deploy-staging.sh` need no change, because
`docker compose` reads `COMPOSE_PROFILES` from `.env`.

| Variable | Default | Notes |
|---|---|---|
| `COMPOSE_PROFILES` | unset | Add `monitoring`, comma-separated with any other profile: `backup,monitoring`. |
| `GRAFANA_CLOUD_PROM_URL` | — | Required. The stack's Prometheus remote-write URL, ending in `/api/prom/push`. |
| `GRAFANA_CLOUD_PROM_USER` | — | Required. The numeric Prometheus user ID shown next to that URL. |
| `GRAFANA_CLOUD_TOKEN` | — | Required. An access policy token with `metrics:write` only. |
| `HEARTBEAT_PING_URL` | unset | The healthchecks.io ping URL for this server's heartbeat check. Unset = no ping. It works without the `monitoring` profile. |
| `MONITORING_MEM_LIMIT` | `256m` | Container memory limit. |

A wrong or missing Grafana Cloud value makes Alloy log `remote_write` errors
(`$COMPOSE logs monitoring`). Nothing else on the server is affected.

## Set up

### 0. Once per estate

One Grafana Cloud stack and one healthchecks.io project serve every server; the
`instance` label keeps them apart. If your estate already has them, take the
values from wherever it keeps its secrets and skip to step 1. Otherwise:

- **Grafana Cloud stack.** Create one at `https://grafana.com/auth/sign-up`;
  the free tier is enough. Its **Prometheus** details page gives the remote-write
  URL and the user ID. Create an access policy token with the `metrics:write`
  scope for `GRAFANA_CLOUD_TOKEN`.
- **Contact point.** At
  `https://<stack>.grafana.net/alerting/notifications`, add an email contact
  point with the ops list's address and make it the default policy's contact
  point. The rules route through that default.
- **healthchecks.io check**, one per server: period 15 minutes, grace 15
  minutes, notifying the ops list by email. Its ping URL is
  `HEARTBEAT_PING_URL`.

On the server, set:

```bash
cd /opt/mediforce
COMPOSE="docker compose -f docker-compose.prod.yml"
# On staging, add the staging overlay:
# COMPOSE="docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml"
```

### 1. Turn on the service

Add to `.env`:

```bash
COMPOSE_PROFILES=backup,monitoring     # keep any profile that is already set
GRAFANA_CLOUD_PROM_URL=https://prometheus-prod-NN-<region>.grafana.net/api/prom/push
GRAFANA_CLOUD_PROM_USER=1234567
GRAFANA_CLOUD_TOKEN=glc_...
HEARTBEAT_PING_URL=https://hc-ping.com/<uuid>
```

Then deploy, or run `$COMPOSE up -d monitoring`. Within two minutes, Grafana
Cloud's **Explore** shows `node_uname_info{instance="<DOMAIN>"}`.

### 2. Apply the alert rules

The rules live in
[`ops/grafana/alert-rules.yaml`](../../ops/grafana/alert-rules.yaml), in the
format Grafana's own export produces. Grafana Cloud can't load provisioning
files, so
[`ops/grafana/apply-alert-rules.py`](../../ops/grafana/apply-alert-rules.py)
pushes them through the provisioning API. Run it once per stack, not per
server, from a laptop. It needs a service account token with the **Editor**
basic role plus the **Alerting → Provisioning writer** fixed role (or the
**Admin** basic role); Editor alone gets a 403 on the rule groups. Keep this
token off the servers: one that can rewrite alerts must not live on a host
those alerts watch.

```bash
GRAFANA_URL=https://<stack>.grafana.net GRAFANA_TOKEN=glsa_... \
  uv run ops/grafana/apply-alert-rules.py
```

It creates the `Mediforce` folder and replaces each rule group. Re-run it after
every change to the file. Applied rules are read-only in the UI, so the file
stays the source of truth.

The rules query the data source with UID `grafanacloud-prom`, which is the UID
of every Grafana Cloud stack's own Prometheus. They route through the default
notification policy, which is the ops-list email contact point.

### 3. Synthetic check on the public URL

Once per domain, add a check at
`https://<stack>.grafana.net/a/grafana-synthetic-monitoring-app/checks/new`:

- **HTTP** check of `https://<DOMAIN>/`, every 1 minute, from at least three
  probe locations.
- Turn **Fail if SSL is not present** on.

The `synthetic` rule group then alerts when every location fails for 5
minutes, or when the certificate has fewer than 14 days left. Turn off the
check's own built-in alerts so you don't get two emails for one outage.

### 4. Dashboards

Import two community dashboards at `https://<stack>.grafana.net/dashboard/import`:

- **Node Exporter Full**, ID `1860`.
- **Cadvisor exporter**, ID `14282`.

Pick the `grafanacloud-<stack>-prom` data source. They need no other changes.

Node Exporter Full picks a server with two dropdowns: **Nodename** is the
server's hostname (`uts: host` on the service), and **Instance** is its
domain.

## Check that alerting works

Run these on staging, never on production:

1. **Disk.** Fill the volume past 75%:
   `fallocate -l <size> /var/lib/mediforce/fill.tmp`. Pick a size that takes
   usage past 75% in `df -h /var/lib/mediforce`. The ops list gets
   *Filesystem above 75%* about 6 minutes later. Then `rm` the file.
2. **Synthetic.** `$COMPOSE stop platform-ui`. *Public URL check failing* fires
   within about 6 minutes. Then `$COMPOSE start platform-ui`.
3. **Heartbeat.** Comment out the `# mediforce-heartbeat` line in
   `crontab -e`. healthchecks.io mails the ops list after the period plus grace
   (30 minutes). Then restore the line, or run
   `python3 scripts/cron-jobs.py install`.

## Alerts

Each alert's `runbook_url` points to its section here.

### Filesystem full

*Filesystem above 75%* (warning) and *above 85%* (critical), per device. The
summary names the device and one of its mount points. The volume's bind
mounts (`/var/lib/docker`, `/var/lib/containerd`, `/var/lib/mediforce`) share
the volume's device.

At 100%, Postgres stops accepting writes and Redis can't save its snapshot. See
[redis-operations.md](redis-operations.md).

First check: `df -h`, then
`sudo du -xh --max-depth=2 /var/lib | sort -h | tail`. Usually the culprit is
images or build cache, and `docker image prune -f` plus
`docker builder prune -f --keep-storage=5GB` clears it. Otherwise look under
`/var/lib/mediforce`. The heartbeat removes finished runs' worktrees, so a
growing `worktrees/` there means the heartbeat isn't running or its sweep is
failing: `$COMPOSE logs platform-ui | grep "worktree"`.

### Filesystem predicted full

At the last 6 hours' rate, a device that is already over half full runs out
within 7 days. It has to hold for an hour before it fires. Find what is growing with the same commands as
above. A large one-off image pull can trigger it briefly, so check whether
usage keeps rising.

### Memory low

Less than 10% of memory available for 5 minutes. The kernel is close to
OOM-killing something. First check: `docker stats --no-stream`, then compare
each service with its `mem_limit`. Agent containers count too. A burst of
concurrent runs is the usual cause.

### OOM kill

The kernel OOM-killed a process in the last 10 minutes. This is the host-wide
counter, so it covers agent containers too. First check:
`sudo dmesg -T | grep -i -A3 "killed process"` to see which process, then
`docker ps -a --filter status=exited` and
`docker inspect -f '{{.State.OOMKilled}}' <container>`. A compose service that
hits its own `mem_limit` gets killed even when the host has room left. Raise
its `*_MEM_LIMIT` in `.env`.

### Container restarting

A compose service started more than twice in 15 minutes. First check:
`$COMPOSE ps` and `$COMPOSE logs --tail 100 <service>`. For Redis, see
[redis-operations.md](redis-operations.md#recovery).

### Host metrics absent

A host sent no metrics for 5 minutes. Either the server is down or the
`monitoring` service is. First check: can you reach `https://<DOMAIN>` and
`ssh` in? If yes, run `$COMPOSE ps monitoring` and `$COMPOSE logs monitoring`.
If not, check the server's status in the Hetzner Console. The alert keeps
firing for a day, then that host drops out of the rule.

### Postgres down

The exporter can't connect to Postgres. The platform can't serve requests.
First check: `$COMPOSE ps postgres` and `$COMPOSE logs --tail 100 postgres`. A
full disk is the most common cause (see *Filesystem full*).

### Redis down

The exporter can't connect to Redis for 2 minutes. Runs can't be queued, and
the snapshot and memory alerts go quiet because their metrics are gone. First
check: `$COMPOSE ps redis` and `$COMPOSE logs --tail 100 redis`, then follow
[redis-operations.md → Recovery](redis-operations.md#recovery).

### Redis snapshot failing

Redis's last RDB save failed, and Redis refuses writes until a save succeeds.
Runs can't be queued. Follow
[redis-operations.md → Recovery](redis-operations.md#recovery).

### Redis memory high

Redis is above 85% of `maxmemory` for 5 minutes. At 100% it refuses every
enqueue. See [redis-operations.md](redis-operations.md).

### Public URL down

Every Synthetic Monitoring location failed to load `https://<DOMAIN>/` for 5
minutes. First check: open the URL. Then, on the server, run `$COMPOSE ps` and
check `platform-ui` and `caddy`. If *Host metrics absent* fires too, the whole
server is down.

### TLS expiring

The certificate has fewer than 14 days left. Caddy renews about 30 days before
expiry, so this means renewal has been failing for two weeks. First check:
`$COMPOSE logs caddy | grep -i -E "error|renew"`. Usually DNS no longer points
at the server, or ports 80/443 are blocked.

### Heartbeat (healthchecks.io)

No successful heartbeat ping for 30 minutes. Cron triggers, the
stranded-run sweep and the removal of finished runs' worktrees have stopped. First check: `crontab -l | grep mediforce-heartbeat`
and `tail /opt/mediforce/logs/heartbeat.log`. `FAIL <code>` lines mean the POST
got an error status, and a bare `FAIL` means nothing answered. Behind Cloudflare,
a `FAIL 403` that `platform-ui`'s logs don't explain is usually Cloudflare's
Browser Integrity Check (`error code: 1010`) rejecting the User-Agent. `ping failed` lines mean the heartbeat
worked but healthchecks.io was unreachable. No new lines mean cron isn't running the
job.
