#!/usr/bin/env python3
"""POST /api/cron/heartbeat, the platform's only clock, and log the result.

Runs on the deployment host from cron (schedule in cron-jobs.py). After each
successful POST it pings HEARTBEAT_PING_URL, when set: healthchecks.io mails the
ops list when the pings stop, whether the platform failed the heartbeat or the
cron line never ran (docs/guides/monitoring.md).

Usage:
    python3 /opt/mediforce/scripts/heartbeat.py
"""

from __future__ import annotations

import argparse
import http.client
import re
import ssl
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

from deploy_env import read_env_file

DEFAULT_DEPLOY_DIR = Path("/opt/mediforce")
HEARTBEAT_TIMEOUT_SECONDS = 120
PING_TIMEOUT_SECONDS = 10
PING_ATTEMPTS = 4
PING_RETRY_PAUSE_SECONDS = 5
REQUEST_ERRORS = (urllib.error.URLError, http.client.HTTPException, OSError)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Report a redirect as its own status, like curl without -L."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


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
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        return context
    return ssl.create_default_context()


def post_heartbeat(domain: str, api_key: str) -> str:
    """The HTTP status code, or FAIL when the platform errored or never answered."""
    request = urllib.request.Request(
        f"https://{domain}/api/cron/heartbeat",
        method="POST",
        headers={"X-Api-Key": api_key, "Content-Type": "application/json"},
    )
    opener = urllib.request.build_opener(
        urllib.request.HTTPSHandler(context=tls_context(domain)), NoRedirect()
    )
    try:
        with opener.open(request, timeout=HEARTBEAT_TIMEOUT_SECONDS) as response:
            return str(response.status)
    except urllib.error.HTTPError as error:
        return str(error.code) if error.code < 400 else "FAIL"
    except REQUEST_ERRORS:
        return "FAIL"


def ping(url: str) -> str | None:
    """None on success, else the last attempt's error."""
    last_error = ""
    for attempt in range(1, PING_ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(url, timeout=PING_TIMEOUT_SECONDS):
                return None
        except REQUEST_ERRORS as error:
            last_error = str(error)
            if attempt < PING_ATTEMPTS:
                time.sleep(PING_RETRY_PAUSE_SECONDS)
    return last_error


def append_log(log: Path, message: str) -> None:
    with log.open("a") as log_file:
        log_file.write(f"[{datetime.now().astimezone().isoformat(timespec='seconds')}] {message}\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="POST the platform heartbeat")
    parser.add_argument("--deploy-dir", type=Path, default=DEFAULT_DEPLOY_DIR)
    args = parser.parse_args()

    env = read_env_file(args.deploy_dir / ".env")
    log = args.deploy_dir / "logs" / "heartbeat.log"
    rotate_weekly(log, args.deploy_dir / "logs" / "heartbeat.last-week.log")

    status = post_heartbeat(env["DOMAIN"], env["PLATFORM_API_KEY"])
    append_log(log, status)

    ping_url = env.get("HEARTBEAT_PING_URL", "")
    if status == "200" and ping_url != "":
        ping_error = ping(ping_url)
        if ping_error is not None:
            append_log(log, f"ping failed: {ping_error}")


if __name__ == "__main__":
    main()
