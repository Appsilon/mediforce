#!/usr/bin/env python3
"""
Seed a WorkflowDefinition into a running platform-ui via HTTP.

Works against any environment that exposes `/api/workflow-definitions`
and honours `PLATFORM_API_KEY` / `X-Api-Key`. The script does not know
about Firestore directly — it just POSTs the JSON and lets the server
validate + store.

Usage:
    python3 scripts/seed-workflow.py --file scripts/examples/sales-csv-report.wd.json \\
        [--url https://staging.mediforce.ai] \\
        [--namespace test]

Env:
    MEDIFORCE_API_KEY or PLATFORM_API_KEY  (required)

Examples:
    # Local dev
    PLATFORM_API_KEY=test-api-key python3 scripts/seed-workflow.py \\
        --file scripts/examples/sales-csv-report.wd.json --url http://localhost:9003

    # Staging
    MEDIFORCE_API_KEY=... python3 scripts/seed-workflow.py \\
        --file scripts/examples/sales-csv-report.wd.json \\
        --url https://staging.mediforce.ai --namespace test
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed a WorkflowDefinition via HTTP.")
    parser.add_argument("--file", required=True, help="Path to the .wd.json file.")
    parser.add_argument("--url", default="http://localhost:9003", help="Base URL of the platform-ui.")
    parser.add_argument("--namespace", default="test", help="Namespace handle to own the workflow.")
    args = parser.parse_args()

    api_key = os.environ.get("MEDIFORCE_API_KEY") or os.environ.get("PLATFORM_API_KEY")
    if not api_key:
        print("Error: MEDIFORCE_API_KEY or PLATFORM_API_KEY env var required.", file=sys.stderr)
        sys.exit(2)

    path = Path(args.file).resolve()
    if not path.exists():
        print(f"Error: file not found: {path}", file=sys.stderr)
        sys.exit(2)

    with path.open() as fh:
        definition = json.load(fh)

    # Strip fields the server sets itself; be forgiving if they're present.
    definition.pop("version", None)
    definition.pop("createdAt", None)

    endpoint = f"{args.url.rstrip('/')}/api/workflow-definitions?{urlencode({'namespace': args.namespace})}"
    body = json.dumps(definition).encode("utf-8")

    req = Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Api-Key": api_key,
        },
    )

    try:
        with urlopen(req) as resp:
            response = json.loads(resp.read().decode("utf-8"))
            print(f"Seeded: {response.get('name')} v{response.get('version')}")
    except HTTPError as err:
        body_text = err.read().decode("utf-8") if err.fp else ""
        print(f"HTTP {err.code}: {body_text}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
