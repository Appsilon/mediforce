#!/usr/bin/env python3
"""Probe Redis and host disk, and alert before writes become unavailable.

Runs on the deployment host (cron, every 5 min — see setup-cron.py). It watches
the five things that, in that order, took production down on 2026-09-15: Redis
outgrew its container limit, the kernel killed it mid-RDB-save, the failed saves
left orphaned `temp-*.rdb` files that filled the root filesystem, and every save
after that failed too — at which point `stop-writes-on-bgsave-error` did its job
and Redis started refusing the writes BullMQ needs (issue #1359).

Each check reports ok / warn / crit. The script exits 0 / 1 / 2 on the worst of
them and prints only the findings, so cron mails you exactly when something is
wrong. Set MEDIFORCE_ALERT_WEBHOOK in the deployment .env to also POST them;
unset, the probe still runs and still logs.

Usage:
    python3 scripts/redis-host-probe.py             # on the host, via cron
    python3 scripts/redis-host-probe.py --verbose   # print every check
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_DEPLOY_DIR = Path("/opt/mediforce")

# Redis memory as a share of its own `maxmemory`, and the root filesystem as a
# share of capacity. Warn leaves room to act; crit means act now.
DEFAULT_THRESHOLDS = {
    "REDIS_MEM_WARN_PCT": 70.0,
    "REDIS_MEM_CRIT_PCT": 80.0,
    "DISK_WARN_PCT": 75.0,
    "DISK_CRIT_PCT": 85.0,
}

LOG_MAX_BYTES = 5 * 1024 * 1024

OK, WARN, CRIT = "ok", "warn", "crit"
EXIT_CODES = {OK: 0, WARN: 1, CRIT: 2}


@dataclass
class Finding:
    check: str
    level: str
    message: str


# A wedged Docker daemon is one of the failures this probe exists to catch, so
# no call to it may block: cron fires again in 5 minutes with no overlap guard.
DOCKER_TIMEOUT_SECONDS = 10


def run(command: list[str]) -> tuple[int, str]:
    try:
        result = subprocess.run(
            command, capture_output=True, text=True, timeout=DOCKER_TIMEOUT_SECONDS
        )
    except subprocess.TimeoutExpired:
        return 124, ""
    return result.returncode, result.stdout.strip()


def read_env_file(path: Path) -> dict[str, str]:
    """Parse the deployment .env for the handful of values the probe needs."""
    if not path.is_file():
        return {}
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        values[key.strip()] = value.strip().strip("'\"")
    return values


def threshold(env: dict[str, str], name: str) -> float:
    raw = env.get(name)
    if raw is None:
        return DEFAULT_THRESHOLDS[name]
    try:
        return float(raw)
    except ValueError:
        return DEFAULT_THRESHOLDS[name]


def find_redis_container() -> str | None:
    """The compose service label, so the probe survives a project rename."""
    code, output = run(
        ["docker", "ps", "--filter", "label=com.docker.compose.service=redis", "--format", "{{.ID}}"]
    )
    if code != 0 or not output:
        return None
    return output.splitlines()[0]


def redis_info(container: str, password: str | None) -> dict[str, str]:
    command = ["docker", "exec"]
    if password:
        command += ["-e", f"REDISCLI_AUTH={password}"]
    command += [container, "redis-cli", "info"]
    code, output = run(command)
    if code != 0:
        return {}
    info: dict[str, str] = {}
    for line in output.splitlines():
        if ":" in line and not line.startswith("#"):
            key, _, value = line.partition(":")
            info[key.strip()] = value.strip()
    return info


def check_persistence(info: dict[str, str]) -> Finding:
    status = info.get("rdb_last_bgsave_status", "unknown")
    if status == "ok":
        return Finding("persistence", OK, "last RDB background save succeeded")
    return Finding(
        "persistence",
        CRIT,
        f"rdb_last_bgsave_status={status} — Redis refuses writes once a save fails "
        "(stop-writes-on-bgsave-error). Check disk space and the Redis log.",
    )


def check_memory(info: dict[str, str], warn_pct: float, crit_pct: float) -> Finding:
    used = int(info.get("used_memory", 0))
    limit = int(info.get("maxmemory", 0))
    if limit == 0:
        return Finding(
            "memory",
            WARN,
            f"maxmemory is unset — Redis will grow until the kernel kills it "
            f"(currently {used / 1024 ** 2:.0f} MiB). Set REDIS_MAX_MEMORY and recreate the container.",
        )
    pct = used / limit * 100
    detail = f"{used / 1024 ** 2:.0f} MiB of {limit / 1024 ** 2:.0f} MiB ({pct:.0f}%)"
    if pct >= crit_pct:
        return Finding("memory", CRIT, f"Redis memory {detail} — writes stop at 100% under noeviction")
    if pct >= warn_pct:
        return Finding("memory", WARN, f"Redis memory {detail}")
    return Finding("memory", OK, f"Redis memory {detail}")


def check_restarts(container: str, state: dict[str, int]) -> tuple[Finding, int]:
    code, output = run(["docker", "inspect", "-f", "{{.RestartCount}}", container])
    if code != 0 or not output.isdigit():
        return Finding("restarts", WARN, "could not read the Redis restart count"), 0
    current = int(output)
    previous = state.get("redis_restart_count", current)
    if current > previous:
        return (
            Finding(
                "restarts",
                CRIT,
                f"Redis restarted {current - previous} time(s) since the last probe "
                f"({current} total) — an OOM kill loses in-flight jobs",
            ),
            current,
        )
    return Finding("restarts", OK, f"Redis restart count steady at {current}"), current


def check_temp_snapshots(container: str) -> Finding:
    code, output = run(
        ["docker", "exec", container, "sh", "-c", "ls -1 /data/temp-*.rdb 2>/dev/null | wc -l"]
    )
    if code != 0 or not output.isdigit():
        return Finding("snapshots", WARN, "could not list /data for orphaned snapshots")
    count = int(output)
    if count == 0:
        return Finding("snapshots", OK, "no orphaned temp-*.rdb files")
    return Finding(
        "snapshots",
        CRIT,
        f"{count} orphaned temp-*.rdb file(s) in /data — each is a save killed part-way "
        "and they fill the disk. Remove them; never remove dump.rdb.",
    )


def check_disk(warn_pct: float, crit_pct: float) -> Finding:
    usage = shutil.disk_usage("/")
    # Root-reserved blocks are capacity nobody can use, and `df` leaves them out
    # of its percentage. Match what the operator sees while recovering a host.
    pct = usage.used / (usage.used + usage.free) * 100
    detail = f"root filesystem {pct:.0f}% used, {usage.free / 1024 ** 3:.0f} GiB free"
    if pct >= crit_pct:
        return Finding("disk", CRIT, f"{detail} — RDB saves need room for a full copy")
    if pct >= warn_pct:
        return Finding("disk", WARN, detail)
    return Finding("disk", OK, detail)


def worst(findings: list[Finding]) -> str:
    for level in (CRIT, WARN):
        if any(finding.level == level for finding in findings):
            return level
    return OK


def post_webhook(url: str, host: str, findings: list[Finding]) -> None:
    """Slack and Discord read different keys and ignore the one they don't know."""
    lines = [f"[{finding.level.upper()}] {finding.check}: {finding.message}" for finding in findings]
    text = f"Mediforce Redis probe on {host}:\n" + "\n".join(lines)
    payload = json.dumps({"text": text, "content": text}).encode("utf-8")
    request = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(request, timeout=10).close()
    except (urllib.error.URLError, TimeoutError) as error:
        print(f"[probe] Could not reach the alert webhook: {error}", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description="Probe Redis and host disk for capacity trouble")
    parser.add_argument("--deploy-dir", type=Path, default=DEFAULT_DEPLOY_DIR)
    parser.add_argument("--verbose", action="store_true", help="Print passing checks too")
    args = parser.parse_args()

    env = read_env_file(args.deploy_dir / ".env")
    log_path = args.deploy_dir / "logs" / "redis-probe.log"
    state_path = args.deploy_dir / "logs" / "redis-probe.state.json"

    state: dict[str, int] = {}
    if state_path.is_file():
        try:
            state = json.loads(state_path.read_text())
        except json.JSONDecodeError:
            state = {}

    container = find_redis_container()
    if container is None:
        findings = [
            Finding(
                "container",
                CRIT,
                f"no running Redis container found (or `docker ps` took over {DOCKER_TIMEOUT_SECONDS}s)",
            )
        ]
        restart_count = state.get("redis_restart_count", 0)
    else:
        info = redis_info(container, env.get("REDIS_PASSWORD"))
        if not info:
            findings = [Finding("container", CRIT, "Redis is running but does not answer INFO")]
            restart_count = state.get("redis_restart_count", 0)
        else:
            restarts, restart_count = check_restarts(container, state)
            findings = [
                check_persistence(info),
                check_memory(
                    info,
                    threshold(env, "REDIS_MEM_WARN_PCT"),
                    threshold(env, "REDIS_MEM_CRIT_PCT"),
                ),
                restarts,
                check_temp_snapshots(container),
            ]
    findings.append(check_disk(threshold(env, "DISK_WARN_PCT"), threshold(env, "DISK_CRIT_PCT")))

    level = worst(findings)
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    log_lines = [f"[{stamp}] {finding.level.upper()} {finding.check}: {finding.message}" for finding in findings]

    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        # Keep one previous log. Unbounded growth on the filesystem this probe
        # watches would be a poor joke.
        if log_path.is_file() and log_path.stat().st_size > LOG_MAX_BYTES:
            log_path.replace(log_path.with_suffix(".log.1"))
        with log_path.open("a") as log:
            log.write("\n".join(log_lines) + "\n")
        state_path.write_text(json.dumps({"redis_restart_count": restart_count}))
    except OSError as error:
        print(f"[probe] Could not write {log_path}: {error}", file=sys.stderr)

    breaches = [finding for finding in findings if finding.level != OK]
    for finding in findings if args.verbose else breaches:
        print(f"{finding.level.upper()} {finding.check}: {finding.message}")

    webhook = env.get("MEDIFORCE_ALERT_WEBHOOK")
    if breaches and webhook:
        post_webhook(webhook, env.get("DOMAIN", "unknown host"), breaches)

    sys.exit(EXIT_CODES[level])


if __name__ == "__main__":
    main()
