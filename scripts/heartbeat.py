#!/usr/bin/env python3
"""POST /api/cron/heartbeat, the platform's only clock, and log the result.

Runs on the deployment host (cron, every 15 min — see cron-jobs.py). After each
successful POST it pings HEARTBEAT_PING_URL, when set: healthchecks.io mails the
ops list when the pings stop, whether the platform failed the heartbeat or the
cron line never ran (docs/guides/monitoring.md).

Usage:
    python3 /opt/mediforce/scripts/heartbeat.py
"""

from __future__ import annotations

import argparse
import re
import ssl
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

DEFAULT_DEPLOY_DIR = Path("/opt/mediforce")
PING_TIMEOUT_SECONDS = 10
PING_ATTEMPTS = 4


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if stripped == "" or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        values[key.removeprefix("export ").strip()] = value.strip().strip("'\"")
    return values


def rotate_weekly(log: Path, previous_log: Path) -> None:
    """Keep this ISO week's lines in `log` and last week's in `previous_log`."""
    if log.is_file() is False:
        return
    last_write_week = datetime.fromtimestamp(log.stat().st_mtime).isocalendar()[:2]
    if last_write_week != datetime.now().isocalendar()[:2]:
        log.replace(previous_log)


def tls_context(domain: str) -> ssl.SSLContext:
    # bootstrap-server.py's "no domain" option sets DOMAIN to the server IP, and
    # Caddy then serves its own self-signed cert. The request goes to this host
    # itself, so skip verification only in that case.
    if re.fullmatch(r"[0-9.]+", domain) is not None or ":" in domain:
        return ssl._create_unverified_context()
    return ssl.create_default_context()


def post_heartbeat(domain: str, api_key: str) -> str:
    """The HTTP status code, or FAIL when the platform errored or never answered."""
    request = urllib.request.Request(
        f"https://{domain}/api/cron/heartbeat",
        method="POST",
        headers={"X-Api-Key": api_key, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, context=tls_context(domain)) as response:
            return str(response.status)
    except (urllib.error.URLError, OSError):
        return "FAIL"


def ping(url: str) -> None:
    for attempt in range(1, PING_ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(url, timeout=PING_TIMEOUT_SECONDS):
                return
        except (urllib.error.URLError, OSError) as error:
            if attempt == PING_ATTEMPTS:
                print(f"[heartbeat] ping failed: {error}", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description="POST the platform heartbeat")
    parser.add_argument("--deploy-dir", type=Path, default=DEFAULT_DEPLOY_DIR)
    args = parser.parse_args()

    env = read_env_file(args.deploy_dir / ".env")
    log = args.deploy_dir / "logs" / "heartbeat.log"
    rotate_weekly(log, args.deploy_dir / "logs" / "heartbeat.last-week.log")

    status = post_heartbeat(env["DOMAIN"], env["PLATFORM_API_KEY"])
    with log.open("a") as log_file:
        log_file.write(f"[{datetime.now().astimezone().isoformat(timespec='seconds')}] {status}\n")

    ping_url = env.get("HEARTBEAT_PING_URL", "")
    if status == "200" and ping_url != "":
        ping(ping_url)


if __name__ == "__main__":
    main()
