#!/usr/bin/env python3
"""Setup or remove Mediforce's cron jobs on a remote server.

Two jobs live here:

    heartbeat    POSTs /api/cron/heartbeat so the platform advances runs whose
                 driver died (stranded-step sweep).
    redis-probe  Watches Redis persistence, memory, restarts, orphaned RDB
                 snapshots and host disk, and alerts before Redis starts
                 refusing writes (issue #1359).

Usage:
    python3 scripts/setup-cron.py deploy@prod.example.com                  # install both
    python3 scripts/setup-cron.py deploy@prod.example.com --job redis-probe
    python3 scripts/setup-cron.py deploy@prod.example.com --remove         # remove both

Each job reads what it needs from the server's /opt/mediforce/.env.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from dataclasses import dataclass

MEDIFORCE_DIR = "/opt/mediforce"


@dataclass(frozen=True)
class CronJob:
    name: str
    comment: str
    command: str
    interval: int
    required_env: tuple[str, ...] = ()
    smoke_command: str | None = None
    required_files: tuple[str, ...] = ()


JOBS = {
    job.name: job
    for job in (
        CronJob(
            name="heartbeat",
            comment="mediforce-heartbeat",
            command=f"{MEDIFORCE_DIR}/scripts/heartbeat.sh",
            interval=15,
            required_env=("PLATFORM_API_KEY", "DOMAIN"),
            smoke_command=(
                f"{MEDIFORCE_DIR}/scripts/heartbeat.sh && tail -1 {MEDIFORCE_DIR}/logs/heartbeat.log"
            ),
            required_files=(f"{MEDIFORCE_DIR}/scripts/heartbeat.sh",),
        ),
        CronJob(
            name="redis-probe",
            comment="mediforce-redis-probe",
            # Findings go to the probe's own log and, when MEDIFORCE_ALERT_WEBHOOK
            # is set, to that webhook. Anything it still prints, cron mails.
            command=f"/usr/bin/python3 {MEDIFORCE_DIR}/scripts/redis-host-probe.py",
            interval=5,
            smoke_command=f"/usr/bin/python3 {MEDIFORCE_DIR}/scripts/redis-host-probe.py --verbose",
            required_files=(f"{MEDIFORCE_DIR}/scripts/redis-host-probe.py",),
        ),
    )
}


def ssh(host: str, command: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["ssh", "-o", "StrictHostKeyChecking=accept-new", host, command],
        capture_output=True,
        text=True,
    )


def install(host: str, job: CronJob, interval: int) -> None:
    for path in job.required_files:
        # cron runs the command verbatim, so a job invoked as the file itself
        # needs the exec bit; one invoked through an interpreter only needs read.
        test_flag = "-x" if job.command == path else "-r"
        if ssh(host, f"test {test_flag} {path}").returncode != 0:
            print(f"ERROR: {path} not found or not executable on {host}")
            print("  Run a deploy first so the repo is on the server.")
            sys.exit(1)

    for var in job.required_env:
        if ssh(host, f"grep -q '^{var}=' {MEDIFORCE_DIR}/.env").returncode != 0:
            print(f"ERROR: {var} not found in {MEDIFORCE_DIR}/.env on {host}")
            sys.exit(1)

    cron_line = f"*/{interval} * * * * {job.command} # {job.comment}"
    install_cmd = (
        f"(crontab -l 2>/dev/null | grep -v '{job.comment}'; echo '{cron_line}') | crontab -"
    )

    result = ssh(host, install_cmd)
    if result.returncode != 0:
        print(f"ERROR: Failed to install {job.name} cron: {result.stderr.strip()}")
        sys.exit(1)

    print(f"Installed {job.name} on {host}:")
    print(f"  Command:  {job.command}")
    print(f"  Interval: every {interval} min")
    print(f"  Crontab:  {ssh(host, f'crontab -l | grep {job.comment}').stdout.strip()}")

    if job.smoke_command is None:
        return

    print("  Smoke test...")
    result = ssh(host, job.smoke_command)
    output = (result.stdout.strip() or result.stderr.strip()).splitlines()
    for line in output:
        print(f"    {line}")
    if job.name == "heartbeat":
        if result.returncode != 0:
            print(f"  WARN: Heartbeat script failed: {result.stderr.strip()}")
        elif "200" not in result.stdout:
            print("  WARN: Expected HTTP 200 — check .env DOMAIN and PLATFORM_API_KEY")
    # The probe exits 1 (warn) / 2 (crit) when it finds real trouble on the
    # host. That is the probe working, not the install failing — but it is
    # exactly what you came to learn, so say so.
    if job.name == "redis-probe" and result.returncode != 0:
        print(f"  NOTE: probe reported findings (exit {result.returncode}) — see above")


def remove(host: str, job: CronJob) -> None:
    result = ssh(host, f"crontab -l 2>/dev/null | grep -v '{job.comment}' | crontab -")
    if result.returncode != 0:
        print(f"ERROR: Failed to remove {job.name} cron: {result.stderr.strip()}")
        sys.exit(1)
    print(f"Removed {job.name} cron from {host}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Setup Mediforce cron jobs on a remote server")
    parser.add_argument("host", help="SSH target (e.g. deploy@staging.example.com)")
    parser.add_argument(
        "--job",
        choices=[*JOBS, "all"],
        default="all",
        help="Which cron job to act on (default: all)",
    )
    parser.add_argument("--remove", action="store_true", help="Remove the cron job(s)")
    parser.add_argument(
        "--interval",
        type=int,
        help="Cron interval in minutes, overriding the job's default (requires --job)",
    )
    args = parser.parse_args()

    if args.interval is not None and args.job == "all":
        parser.error("--interval applies to one job — name it with --job")

    selected = list(JOBS.values()) if args.job == "all" else [JOBS[args.job]]

    for job in selected:
        if args.remove:
            remove(args.host, job)
        else:
            install(args.host, job, args.interval or job.interval)


if __name__ == "__main__":
    main()
