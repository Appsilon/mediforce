#!/usr/bin/env python3
"""Seed the mock SFTP staging dir with files from a demo variant.

Runs on the host as a developer helper — copies files from
`studies/{study}/data/{variant}/` into `studies/{study}/data/sftp-staging/`,
which is mounted into the atmoz/sftp container at /home/cro/upload.

Operator simulates a "new delivery arrives" by:

    python apps/landing-zone/scripts/seed_sftp.py --variant clean

The staging dir is cleared first so each call models a fresh delivery.

For the `mess-late` variant, the mtimes of the dropped files are also
backdated by 14 days. The sftp-poll step compares listings (filename,
size, mtime) against `previousRun.previousListing`, but downstream demos
of contract.expectedDeliveries[].cadence breach use the file mtime as a
simple proxy for "this delivery is overdue".

Usage:
    python apps/landing-zone/scripts/seed_sftp.py --variant clean
    python apps/landing-zone/scripts/seed_sftp.py --variant mess-late --study CDISCPILOT01
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import time
from pathlib import Path

VARIANTS = (
    "clean",
    "injection",
    "mess-late",
    "mess-encoding",
    "mess-missing-domain",
    "mess-inconsistent-values",
)

# How far back to set mtimes for the `mess-late` variant. The contract in
# studies/CDISCPILOT01/config.yaml expects weekly SDTM deliveries, so 14
# days places the files clearly past the deadline.
LATE_OFFSET_DAYS = 14


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--variant", required=True, choices=VARIANTS, help="Demo data variant to drop into SFTP staging.")
    parser.add_argument("--study", default="CDISCPILOT01", help="Study ID (default: CDISCPILOT01).")
    return parser.parse_args()


def clear_staging(staging: Path) -> int:
    removed = 0
    for entry in staging.iterdir():
        if entry.name == ".gitkeep":
            continue
        if entry.is_dir():
            shutil.rmtree(entry)
        else:
            entry.unlink()
        removed += 1
    return removed


def copy_variant(source: Path, staging: Path) -> list[Path]:
    copied: list[Path] = []
    for entry in sorted(source.iterdir()):
        if entry.is_dir():
            destination = staging / entry.name
            shutil.copytree(entry, destination)
            for nested in destination.rglob("*"):
                if nested.is_file():
                    copied.append(nested)
        else:
            destination = staging / entry.name
            shutil.copy2(entry, destination)
            copied.append(destination)
    return copied


def backdate(files: list[Path], days: int) -> None:
    timestamp = time.time() - (days * 86400)
    for path in files:
        os.utime(path, (timestamp, timestamp))


def main() -> int:
    args = parse_args()

    study_data = repo_root() / "apps" / "landing-zone" / "studies" / args.study / "data"
    source = study_data / args.variant
    staging = study_data / "sftp-staging"

    if not source.is_dir():
        print(
            f"seed_sftp: variant directory not found at {source}, run the demo data prep first.",
            file=sys.stderr,
        )
        return 1

    if not staging.is_dir():
        print(f"seed_sftp: staging directory not found at {staging}.", file=sys.stderr)
        return 1

    removed = clear_staging(staging)
    print(f"seed_sftp: cleared {removed} entries from {staging}", file=sys.stderr)

    copied = copy_variant(source, staging)
    print(f"seed_sftp: copied {len(copied)} files from {source} to {staging}", file=sys.stderr)

    if args.variant == "mess-late" and copied:
        backdate(copied, LATE_OFFSET_DAYS)
        print(f"seed_sftp: backdated mtimes by {LATE_OFFSET_DAYS} days for mess-late variant", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
