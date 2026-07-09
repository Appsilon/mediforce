#!/usr/bin/env python3
"""
Backfill namespace on agent definitions that don't have one.

Agents without a namespace are invisible to browser users because
filterByNamespace() requires a matching namespace. This script lists
affected agents and (with --apply) sets the namespace via PUT.

Usage:
    # List agents without namespace (dry run)
    python3 scripts/migrations/backfill_agent_namespaces.py \
        --base-url https://staging.mediforce.ai

    # Apply — set namespace on all agents
    python3 scripts/migrations/backfill_agent_namespaces.py \
        --base-url https://staging.mediforce.ai --namespace mediforce --apply
"""

import argparse
import json
import os
import subprocess
import sys


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
    parser = argparse.ArgumentParser(description="Backfill namespace on agent definitions")
    parser.add_argument("--base-url", required=True, help="Mediforce API base URL")
    parser.add_argument("--namespace", help="Namespace to set on agents without one")
    parser.add_argument("--apply", action="store_true", help="Actually apply changes (default: dry run)")
    args = parser.parse_args()

    api_key = os.environ.get("MEDIFORCE_API_KEY")
    if not api_key:
        print("ERROR: MEDIFORCE_API_KEY environment variable is required", file=sys.stderr)
        return 1

    if args.apply and not args.namespace:
        print("ERROR: --namespace is required when using --apply", file=sys.stderr)
        return 1

    base_url = args.base_url.rstrip("/")

    status, data = api_call(base_url, api_key, "GET", "/api/agent-definitions")
    if status != 200:
        print(f"ERROR: Failed to list agents: HTTP {status}", file=sys.stderr)
        return 1

    agents = data.get("agents", [])
    missing = [a for a in agents if not a.get("namespace")]

    if not missing:
        print(f"All {len(agents)} agents already have a namespace. Nothing to do.")
        return 0

    print(f"Found {len(missing)}/{len(agents)} agents without namespace:\n")
    for agent in missing:
        print(f"  {agent['id']:40s}  {agent['name']}")

    if not args.apply:
        print(f"\nDry run — pass --namespace <ns> --apply to set namespace on these {len(missing)} agents.")
        return 0

    print(f"\nApplying namespace={args.namespace!r} to {len(missing)} agents...")
    errors = 0
    for agent in missing:
        agent_id = agent["id"]
        status, result = api_call(base_url, api_key, "PUT", f"/api/agent-definitions/{agent_id}", {"namespace": args.namespace})
        if status == 200:
            print(f"  OK  {agent_id}  {agent['name']}")
        else:
            print(f"  ERR {agent_id}  {agent['name']}: HTTP {status} — {result.get('error', json.dumps(result))}")
            errors += 1

    if errors > 0:
        print(f"\nDone with {errors} error(s).")
        return 1

    print(f"\nDone. {len(missing)} agents set to namespace={args.namespace!r}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
