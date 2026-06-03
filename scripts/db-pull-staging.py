#!/usr/bin/env python3
"""Pull a Postgres dump from a remote staging host into the local dev container.

Usage:
    python3 scripts/db-pull-staging.py 204.168.165.57
    python3 scripts/db-pull-staging.py 204.168.165.57 --user deploy
    python3 scripts/db-pull-staging.py 204.168.165.57 --keep-dump

The script SSHs into the remote host, runs pg_dump inside the staging Postgres
container, streams the dump locally, then restores it into the local dev
container (mediforce-dev-postgres-1). Existing local data is replaced.
"""

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

LOCAL_CONTAINER = "mediforce-dev-postgres-1"
REMOTE_CONTAINER = "mediforce-postgres-1"
DB_USER = "mediforce"
DB_NAME = "mediforce"


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    print(f"  $ {' '.join(cmd)}")
    return subprocess.run(cmd, check=True, **kwargs)


def check_local_container() -> None:
    result = subprocess.run(
        ["docker", "inspect", "--format", "{{.State.Running}}", LOCAL_CONTAINER],
        capture_output=True, text=True,
    )
    if result.returncode != 0 or result.stdout.strip() != "true":
        print(f"Error: local container {LOCAL_CONTAINER} not running.")
        print("Start it first:  pnpm dev  (or docker compose up postgres -d)")
        sys.exit(1)


def dump_remote(host: str, user: str, dump_path: Path) -> None:
    print(f"\n1. Dumping staging DB from {user}@{host} ...")
    ssh_cmd = (
        f"docker exec {REMOTE_CONTAINER} "
        f"pg_dump -U {DB_USER} -Fc --no-owner --no-acl {DB_NAME}"
    )
    with open(dump_path, "wb") as f:
        run(["ssh", f"{user}@{host}", ssh_cmd], stdout=f)

    size_mb = dump_path.stat().st_size / (1024 * 1024)
    print(f"   Dump saved: {dump_path} ({size_mb:.1f} MB)")


def restore_local(dump_path: Path) -> None:
    print("\n2. Restoring into local container ...")
    with open(dump_path, "rb") as f:
        run(
            [
                "docker", "exec", "-i", LOCAL_CONTAINER,
                "pg_restore", "-U", DB_USER, "-d", DB_NAME,
                "--clean", "--if-exists", "--no-owner", "--no-acl", "-Fc",
            ],
            stdin=f,
        )
    print("   Restore complete.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Pull staging DB into local dev Postgres")
    parser.add_argument("host", help="Staging host IP or hostname")
    parser.add_argument("--user", default="deploy", help="SSH user (default: deploy)")
    parser.add_argument("--keep-dump", action="store_true", help="Keep the dump file after restore")
    args = parser.parse_args()

    check_local_container()

    if args.keep_dump:
        dump_path = REPO_ROOT / "staging-dump.dump"
    else:
        tmp = tempfile.NamedTemporaryFile(suffix=".dump", delete=False)
        dump_path = Path(tmp.name)
        tmp.close()

    try:
        dump_remote(args.host, args.user, dump_path)
        restore_local(dump_path)
        print("\nDone. Local DB now mirrors staging.")
    finally:
        if not args.keep_dump:
            dump_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
