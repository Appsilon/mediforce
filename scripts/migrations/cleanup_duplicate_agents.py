#!/usr/bin/env python3
"""
Remove duplicate agent definitions, keeping only the newest per runtimeId.
Agents without a runtimeId (custom agents) are always kept.

Usage:
    # Dry run (default)
    python3 scripts/migrations/cleanup_duplicate_agents.py \
        --base-url https://staging.mediforce.ai

    # Apply
    python3 scripts/migrations/cleanup_duplicate_agents.py \
        --base-url https://staging.mediforce.ai --apply
"""

import argparse
import json
import os
import subprocess
import sys
from collections import defaultdict


def api_call(base_url: str, api_key: str, method: str, path: str) -> tuple[int, dict]:
    url = f"{base_url}{path}"
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "-X", method, "-H", f"X-Api-Key: {api_key}", url]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    lines = result.stdout.strip().rsplit("\n", 1)
    status = int(lines[-1]) if len(lines) > 1 else 0
    try:
        data = json.loads(lines[0]) if lines[0] else {}
    except json.JSONDecodeError:
        data = {"raw": lines[0]}
    return status, data


def main() -> int:
    parser = argparse.ArgumentParser(description="Remove duplicate agent definitions")
    parser.add_argument("--base-url", required=True, help="Mediforce API base URL")
    parser.add_argument("--apply", action="store_true", help="Actually delete (default: dry run)")
    args = parser.parse_args()

    api_key = os.environ.get("MEDIFORCE_API_KEY")
    if not api_key:
        print("ERROR: MEDIFORCE_API_KEY environment variable is required", file=sys.stderr)
        return 1

    base_url = args.base_url.rstrip("/")

    status, data = api_call(base_url, api_key, "GET", "/api/agent-definitions")
    if status != 200:
        print(f"ERROR: Failed to list agents: HTTP {status}", file=sys.stderr)
        return 1

    agents = data.get("agents", [])

    groups: dict[str, list[dict]] = defaultdict(list)
    unique = []
    for agent in agents:
        runtime_id = agent.get("runtimeId")
        if runtime_id:
            groups[runtime_id].append(agent)
        else:
            unique.append(agent)

    to_delete: list[dict] = []
    to_keep: list[dict] = list(unique)

    for runtime_id, group in sorted(groups.items()):
        sorted_group = sorted(group, key=lambda a: a.get("createdAt", ""), reverse=True)
        keeper = sorted_group[0]
        to_keep.append(keeper)
        to_delete.extend(sorted_group[1:])

    if not to_delete:
        print(f"No duplicates found among {len(agents)} agents. Nothing to do.")
        return 0

    print(f"Keeping {len(to_keep)} agents, deleting {len(to_delete)} duplicates:\n")

    print("KEEP:")
    for agent in sorted(to_keep, key=lambda a: a.get("name", "")):
        rid = agent.get("runtimeId", "(custom)")
        print(f"  {agent['id']:45s}  {agent['name']:30s}  runtime={rid}")

    print(f"\nDELETE ({len(to_delete)}):")
    for agent in to_delete:
        rid = agent.get("runtimeId", "(custom)")
        print(f"  {agent['id']:45s}  {agent['name']:30s}  runtime={rid}  created={agent.get('createdAt', '?')[:10]}")

    if not args.apply:
        print(f"\nDry run — pass --apply to delete {len(to_delete)} duplicate agents.")
        return 0

    print(f"\nDeleting {len(to_delete)} duplicates...")
    errors = 0
    for agent in to_delete:
        agent_id = agent["id"]
        status, result = api_call(base_url, api_key, "DELETE", f"/api/agent-definitions/{agent_id}")
        if status == 200 and result.get("success"):
            print(f"  OK  {agent_id}  {agent['name']}")
        else:
            print(f"  ERR {agent_id}  {agent['name']}: HTTP {status} — {result.get('error', json.dumps(result))}")
            errors += 1

    if errors > 0:
        print(f"\nDone with {errors} error(s).")
        return 1

    print(f"\nDone. Deleted {len(to_delete)} duplicates, kept {len(to_keep)} agents.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
