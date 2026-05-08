#!/usr/bin/env python3
"""
Set visibility='private' on all workflow definitions that don't have
the field set yet. Safe to run multiple times (idempotent).

Existing workflows without a visibility field predate the access control
feature and should default to private (pharma-safe default). The schema
default handles new workflows; this script backfills old ones.

Usage:
    # Dry run (default)
    MEDIFORCE_API_KEY=$MEDIFORCE_API_KEY python3 scripts/migrate_workflow_visibility.py \
        --base-url https://staging.mediforce.ai

    # Apply
    MEDIFORCE_API_KEY=$MEDIFORCE_API_KEY python3 scripts/migrate_workflow_visibility.py \
        --base-url https://staging.mediforce.ai --apply
"""

import argparse
import json
import os
import subprocess
import sys
import urllib.parse


def api_call(base_url: str, api_key: str, method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    url = f"{base_url}{path}"
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "-X", method, "-H", f"X-Api-Key: {api_key}"]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(body)]
    cmd.append(url)
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    lines = result.stdout.strip().rsplit("\n", 1)
    status = int(lines[-1]) if len(lines) > 1 else 0
    try:
        data = json.loads(lines[0]) if lines[0] else {}
    except json.JSONDecodeError:
        data = {"raw": lines[0]}
    return status, data


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill visibility=private on old workflow definitions")
    parser.add_argument("--base-url", required=True, help="Mediforce API base URL")
    parser.add_argument("--apply", action="store_true", help="Actually apply changes (default: dry run)")
    args = parser.parse_args()

    api_key = os.environ.get("MEDIFORCE_API_KEY")
    if not api_key:
        print("ERROR: MEDIFORCE_API_KEY environment variable is required", file=sys.stderr)
        return 1

    base_url = args.base_url.rstrip("/")

    status, data = api_call(base_url, api_key, "GET", "/api/workflow-definitions")
    if status != 200:
        print(f"ERROR: Failed to list workflows: HTTP {status}", file=sys.stderr)
        return 1

    definitions = data.get("definitions", [])
    needs_migration = []

    for group in definitions:
        defn = group.get("definition")
        if defn is None:
            continue
        visibility = defn.get("visibility")
        if visibility is None or visibility == "":
            needs_migration.append(group["name"])

    if not needs_migration:
        print(f"All {len(definitions)} workflows already have visibility set. Nothing to do.")
        return 0

    print(f"Found {len(needs_migration)}/{len(definitions)} workflows without visibility:")
    for name in needs_migration:
        print(f"  - {name}")

    if not args.apply:
        print(f"\nDry run — pass --apply to set visibility=private on these {len(needs_migration)} workflows.")
        return 0

    print(f"\nApplying visibility=private to {len(needs_migration)} workflows...")
    errors = 0
    for name in needs_migration:
        encoded = urllib.parse.quote(name, safe="")
        status, result = api_call(base_url, api_key, "PATCH", f"/api/workflow-definitions/{encoded}", {"visibility": "private"})
        if status == 200 and result.get("success"):
            print(f"  OK  {name}")
        else:
            print(f"  ERR {name}: HTTP {status} — {result.get('error', json.dumps(result))}")
            errors += 1

    if errors > 0:
        print(f"\nDone with {errors} error(s).")
        return 1

    print(f"\nDone. {len(needs_migration)} workflows set to private.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
