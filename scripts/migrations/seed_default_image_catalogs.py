#!/usr/bin/env python3
"""
Seed existing workspaces with the images a step falls back to (#1376).

Every workspace created from now on is seeded at creation — by
`createNamespace` and by the personal-workspace bootstrap in `getMe`. This
backfills the ones created before that, which open on an empty Image Catalog
and a step-editor picker showing the raw deployment-wide daemon listing.

Deliberately a script and not a lazy seed on read: `listImageCatalogEntries` is
polled every 30 seconds, and turning that into a write path is what ADR-0022
decision 7 avoids by deriving discovered entries instead of storing them.

The rows come from `DEFAULT_IMAGE_CATALOG_ENTRIES` server-side, through the
same helper both creation paths call — this script names workspaces, never
images, so it cannot drift from the engine's defaults.

Re-runnable: entries are keyed on their source, so seeding twice upserts the
same five rows.

Usage:
    # Dry run — prints what it would seed.
    python3 scripts/migrations/seed_default_image_catalogs.py \
        --namespace acme --namespace marek

    # One handle per line (blank lines and `#` comments ignored).
    python3 scripts/migrations/seed_default_image_catalogs.py \
        --from-file /tmp/handles.txt --apply

Handles come from the deployment's database, e.g.

    docker exec mediforce-postgres-1 \
        psql -U mediforce -d mediforce -t -A -c 'select handle from workspaces'
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def run_cli(args: list[str], cli: str) -> tuple[int, str]:
    """Invoke the Mediforce CLI. Dogfooding is mandatory (AGENTS.md §4)."""
    result = subprocess.run(
        cli.split() + args,
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
        timeout=120,
    )
    return result.returncode, (result.stdout or "") + (result.stderr or "")


def read_handles(args: argparse.Namespace) -> list[str]:
    handles = list(args.namespace)
    if args.from_file is not None:
        for raw in Path(args.from_file).read_text(encoding="utf-8").splitlines():
            line = raw.split("#", 1)[0].strip()
            if line:
                handles.append(line)
    # De-duplicated, order kept, so a handle listed twice is seeded once and the
    # report reads in the order the operator wrote it.
    return list(dict.fromkeys(handles))


def seed(handle: str, cli: str) -> int:
    code, out = run_cli(["images", "seed", "--namespace", handle, "--json"], cli)
    if code != 0:
        raise RuntimeError(out.strip())
    start = out.find("{")
    if start < 0:
        raise RuntimeError(f"No JSON in output:\n{out.strip()}")
    return int(json.loads(out[start:])["seeded"])


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Seed existing workspaces with the engine's default images (#1376)",
    )
    parser.add_argument(
        "--namespace", action="append", default=[], help="Workspace handle (repeatable)",
    )
    parser.add_argument("--from-file", help="File of workspace handles, one per line")
    parser.add_argument(
        "--apply", action="store_true", help="Write. Without it, this only prints the plan",
    )
    parser.add_argument(
        "--cli", default="pnpm exec mediforce", help="CLI invocation (default: pnpm exec mediforce)",
    )
    args = parser.parse_args()

    handles = read_handles(args)
    if not handles:
        parser.error("Pass at least one --namespace or a --from-file")

    if not args.apply:
        print(f"Would seed {len(handles)} workspace(s) — re-run with --apply:")
        for handle in handles:
            print(f"  {handle}")
        return 0

    failed = 0
    for handle in handles:
        try:
            print(f"  {handle}: seeded {seed(handle, args.cli)} entries")
        except (RuntimeError, ValueError, KeyError) as error:
            # One unreachable workspace must not strand the other 29.
            failed += 1
            print(f"  {handle}: FAILED — {error}", file=sys.stderr)

    print(f"\nSeeded {len(handles) - failed}/{len(handles)} workspace(s).")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
