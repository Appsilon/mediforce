#!/usr/bin/env python3
"""
Backfill visibility on agent definitions that don't have one.

Platform agents get visibility="public" (visible to all namespaces).
All other agents get visibility="private" (visible only within their namespace).

Usage:
    # List agents without visibility (dry run)
    python3 scripts/migrations/backfill_agent_visibility.py \
        --base-url https://staging.mediforce.ai

    # Apply — set visibility on all agents
    python3 scripts/migrations/backfill_agent_visibility.py \
        --base-url https://staging.mediforce.ai --apply
"""

import argparse
import json
import os
import subprocess
import sys


PLATFORM_AGENT_IDS = {
    "claude-code-agent",
    "opencode-agent",
    "script-container",
    "supply-intelligence-driver-agent",
    "supply-intelligence-risk-detection",
    "tealflow-cowork-chat",
}


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
    parser = argparse.ArgumentParser(description="Backfill visibility on agent definitions")
    parser.add_argument("--base-url", required=True, help="Mediforce API base URL")
    parser.add_argument("--apply", action="store_true", help="Actually apply changes (default: dry run)")
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
    missing = [a for a in agents if not a.get("visibility")]

    if not missing:
        print(f"All {len(agents)} agents already have visibility set. Nothing to do.")
        return 0

    print(f"Found {len(missing)}/{len(agents)} agents without visibility:\n")
    for agent in missing:
        target = "public" if agent["id"] in PLATFORM_AGENT_IDS else "private"
        print(f"  {agent['id']:50s}  {agent['name']:30s}  -> {target}")

    if not args.apply:
        print(f"\nDry run — pass --apply to set visibility on these {len(missing)} agents.")
        return 0

    print(f"\nApplying visibility to {len(missing)} agents...")
    errors = 0
    for agent in missing:
        agent_id = agent["id"]
        visibility = "public" if agent_id in PLATFORM_AGENT_IDS else "private"
        status, result = api_call(base_url, api_key, "PUT", f"/api/agent-definitions/{agent_id}", {"visibility": visibility})
        if status == 200:
            print(f"  OK  {agent_id:50s}  -> {visibility}")
        else:
            print(f"  ERR {agent_id:50s}  -> {visibility}: HTTP {status} -- {result.get('error', json.dumps(result))}")
            errors += 1

    if errors > 0:
        print(f"\nDone with {errors} error(s).")
        return 1

    print(f"\nDone. {len(missing)} agents updated with visibility.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
