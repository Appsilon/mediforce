#!/usr/bin/env python3
"""Setup or remove the heartbeat cron job on a remote server.

Usage:
    python3 scripts/setup-cron.py deploy@staging.example.com   # install
    python3 scripts/setup-cron.py deploy@prod.example.com      # install
    python3 scripts/setup-cron.py deploy@staging.example.com --remove

The script reads PLATFORM_API_KEY from the server's /opt/mediforce/.env
and DOMAIN from the same file to construct the heartbeat URL.
Interval defaults to 15 minutes (matching the old GHA cron).
"""

import argparse
import subprocess
import sys

CRON_COMMENT = "mediforce-heartbeat"
MEDIFORCE_DIR = "/opt/mediforce"
HEARTBEAT_SCRIPT = f"{MEDIFORCE_DIR}/scripts/heartbeat.sh"
DEFAULT_INTERVAL = 15


def ssh(host: str, command: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["ssh", "-o", "StrictHostKeyChecking=accept-new", host, command],
        capture_output=True,
        text=True,
    )


def install(host: str, interval: int) -> None:
    # Verify heartbeat script exists on server
    result = ssh(host, f"test -x {HEARTBEAT_SCRIPT}")
    if result.returncode != 0:
        print(f"ERROR: {HEARTBEAT_SCRIPT} not found or not executable on {host}")
        print("  Run a deploy first so the repo is on the server.")
        sys.exit(1)

    # Verify .env has both required vars
    for var in ("PLATFORM_API_KEY", "DOMAIN"):
        result = ssh(host, f"grep -q '^{var}=' {MEDIFORCE_DIR}/.env")
        if result.returncode != 0:
            print(f"ERROR: {var} not found in {MEDIFORCE_DIR}/.env on {host}")
            sys.exit(1)

    cron_line = f"*/{interval} * * * * {HEARTBEAT_SCRIPT} # {CRON_COMMENT}"

    # Remove old entry if exists, then append new one
    install_cmd = (
        f"(crontab -l 2>/dev/null | grep -v '{CRON_COMMENT}'; "
        f"echo '{cron_line}') | crontab -"
    )

    result = ssh(host, install_cmd)
    if result.returncode != 0:
        print(f"ERROR: Failed to install cron: {result.stderr.strip()}")
        sys.exit(1)

    print(f"Installed on {host}:")
    print(f"  Script:   {HEARTBEAT_SCRIPT}")
    print(f"  Interval: every {interval} min")

    # Verify crontab was written
    result = ssh(host, f"crontab -l | grep '{CRON_COMMENT}'")
    print(f"  Crontab:  {result.stdout.strip()}")

    # Smoke test: run the heartbeat script and check exit code + log output
    print("\n  Smoke test...")
    result = ssh(host, f"{HEARTBEAT_SCRIPT} && tail -1 {MEDIFORCE_DIR}/logs/heartbeat.log")
    if result.returncode != 0:
        print(f"  WARN: Heartbeat script failed: {result.stderr.strip()}")
    else:
        last_line = result.stdout.strip()
        print(f"  Result:   {last_line}")
        if "200" not in last_line:
            print("  WARN: Expected HTTP 200 — check .env DOMAIN and PLATFORM_API_KEY")


def remove(host: str) -> None:
    cmd = f"crontab -l 2>/dev/null | grep -v '{CRON_COMMENT}' | crontab -"
    result = ssh(host, cmd)
    if result.returncode != 0:
        print(f"ERROR: Failed to remove cron: {result.stderr.strip()}")
        sys.exit(1)
    print(f"Removed heartbeat cron from {host}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Setup heartbeat cron on remote server")
    parser.add_argument("host", help="SSH target (e.g. deploy@staging.example.com)")
    parser.add_argument("--remove", action="store_true", help="Remove the cron job")
    parser.add_argument(
        "--interval",
        type=int,
        default=DEFAULT_INTERVAL,
        help=f"Cron interval in minutes (default: {DEFAULT_INTERVAL})",
    )
    args = parser.parse_args()

    if args.remove:
        remove(args.host)
    else:
        install(args.host, args.interval)


if __name__ == "__main__":
    main()
