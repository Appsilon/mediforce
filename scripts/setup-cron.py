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
DEFAULT_INTERVAL = 15


def ssh(host: str, command: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["ssh", "-o", "StrictHostKeyChecking=accept-new", host, command],
        capture_output=True,
        text=True,
    )


def install(host: str, interval: int) -> None:
    # Read env vars from server
    result = ssh(host, f"grep -E '^(PLATFORM_API_KEY|DOMAIN)=' {MEDIFORCE_DIR}/.env")
    if result.returncode != 0:
        print(f"ERROR: Cannot read .env on {host}: {result.stderr.strip()}")
        sys.exit(1)

    env = {}
    for line in result.stdout.strip().splitlines():
        key, _, value = line.partition("=")
        env[key] = value.strip().strip('"').strip("'")

    for key in ("PLATFORM_API_KEY", "DOMAIN"):
        if key not in env:
            print(f"ERROR: {key} not found in {MEDIFORCE_DIR}/.env on {host}")
            sys.exit(1)

    url = f"https://{env['DOMAIN']}/api/cron/heartbeat"
    api_key = env["PLATFORM_API_KEY"]

    cron_line = (
        f"*/{interval} * * * * "
        f'curl -sf -X POST "{url}" '
        f'-H "X-Api-Key: {api_key}" '
        f'-H "Content-Type: application/json" '
        f">/dev/null 2>&1 "
        f"# {CRON_COMMENT}"
    )

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
    print(f"  URL:      {url}")
    print(f"  Interval: every {interval} min")

    # Verify
    result = ssh(host, f"crontab -l | grep '{CRON_COMMENT}'")
    print(f"  Crontab:  {result.stdout.strip()}")


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
