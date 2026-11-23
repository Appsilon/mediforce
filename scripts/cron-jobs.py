#!/usr/bin/env python3
"""Install Mediforce's host cron jobs into the current user's crontab.

Runs on the deployment host. deploy.sh and deploy-staging.sh call it on every
deploy, so every server (forks included) runs the same jobs with no manual step
(issue #1685):

    heartbeat    POSTs /api/cron/heartbeat, the platform's only clock: cron
                 triggers, the stranded-run sweep, the model-registry sweep.
    redis-probe  Watches Redis persistence, memory, restarts, orphaned RDB
                 snapshots and host disk, and alerts before Redis starts
                 refusing writes (issue #1359).

Usage (on the host, as the deploy user):
    python3 /opt/mediforce/scripts/cron-jobs.py install
    python3 /opt/mediforce/scripts/cron-jobs.py remove

`install` rewrites every `# mediforce-<job>` crontab line, so a changed
interval or command, or a job dropped from JOBS, takes effect on the next
deploy. Lines without that marker are left alone. A job whose required env is
missing from .env is skipped with a warning instead of failing the deploy.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

DEFAULT_DEPLOY_DIR = Path("/opt/mediforce")
MANAGED_LINE = re.compile(r"# mediforce-[a-z0-9-]+\s*$")


@dataclass(frozen=True)
class CronJob:
    name: str
    command: str
    interval_minutes: int
    required_env: tuple[str, ...] = ()

    @property
    def marker(self) -> str:
        return f"mediforce-{self.name}"

    def cron_line(self, deploy_dir: Path) -> str:
        command = self.command.format(deploy_dir=deploy_dir)
        return f"*/{self.interval_minutes} * * * * {command} # {self.marker}"


JOBS = (
    CronJob(
        name="heartbeat",
        command="/bin/bash {deploy_dir}/scripts/heartbeat.sh",
        interval_minutes=15,
        required_env=("PLATFORM_API_KEY", "DOMAIN"),
    ),
    CronJob(
        name="redis-probe",
        # Findings go to the probe's own log and, when MEDIFORCE_ALERT_WEBHOOK
        # is set, to that webhook. Anything it still prints, cron mails.
        command="/usr/bin/python3 {deploy_dir}/scripts/redis-host-probe.py",
        interval_minutes=5,
    ),
)


def read_env_keys(env_path: Path) -> set[str]:
    """Keys that .env sets to a non-empty value."""
    if env_path.is_file() is False:
        return set()
    keys: set[str] = set()
    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if value.strip().strip("'\"") != "":
            keys.add(key.removeprefix("export ").strip())
    return keys


def read_crontab() -> list[str]:
    result = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
    # `crontab -l` exits 1 with "no crontab for <user>" when there is none yet.
    if result.returncode != 0:
        return []
    return result.stdout.splitlines()


def write_crontab(lines: list[str]) -> None:
    content = "".join(f"{line}\n" for line in lines)
    subprocess.run(["crontab", "-"], input=content, text=True, check=True)


def unmanaged_lines(lines: list[str]) -> list[str]:
    return [line for line in lines if MANAGED_LINE.search(line) is None]


def install(deploy_dir: Path) -> None:
    (deploy_dir / "logs").mkdir(parents=True, exist_ok=True)
    env_keys = read_env_keys(deploy_dir / ".env")

    managed: list[str] = []
    for job in JOBS:
        missing = [key for key in job.required_env if key not in env_keys]
        if missing:
            print(f"[cron] WARN: skipping {job.name} — {', '.join(missing)} not set in {deploy_dir}/.env")
            continue
        managed.append(job.cron_line(deploy_dir))
        print(f"[cron] {job.name}: every {job.interval_minutes} min")

    write_crontab(unmanaged_lines(read_crontab()) + managed)


def remove() -> None:
    write_crontab(unmanaged_lines(read_crontab()))
    print("[cron] removed every mediforce-* job")


def main() -> None:
    parser = argparse.ArgumentParser(description="Install Mediforce's host cron jobs")
    parser.add_argument("action", choices=("install", "remove"))
    parser.add_argument("--deploy-dir", type=Path, default=DEFAULT_DEPLOY_DIR)
    args = parser.parse_args()

    try:
        if args.action == "install":
            install(args.deploy_dir)
        else:
            remove()
    except (subprocess.CalledProcessError, FileNotFoundError, PermissionError) as error:
        print(f"[cron] ERROR: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
