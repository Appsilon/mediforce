#!/usr/bin/env python3
"""
Seed the cowork-workflow-designer definition into the platform.

Usage:
    python scripts/seed-cowork-designer.py [--port PORT]

Requires:
    - Platform UI running on localhost (default port 9003)
    - MEDIFORCE_API_KEY env var set
"""

import json
import os
import sys
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

def main():
    port = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else os.environ.get("PORT", "9003")
    api_key = os.environ.get("MEDIFORCE_API_KEY") or os.environ.get("PLATFORM_API_KEY")

    if not api_key:
        print("Error: MEDIFORCE_API_KEY or PLATFORM_API_KEY env var required")
        sys.exit(1)

    definition_path = Path(__file__).parent.parent / "apps" / "workflow-designer" / "src" / "cowork-workflow-designer.wd.json"

    if not definition_path.exists():
        print(f"Error: Definition file not found at {definition_path}")
        sys.exit(1)

    with open(definition_path) as f:
        definition = json.load(f)

    # Add version if missing
    if "version" not in definition:
        definition["version"] = 1

    base_url = f"http://localhost:{port}"
    url = f"{base_url}/api/workflow-definitions"

    print(f"Registering '{definition['name']}' v{definition['version']} to {url}...")

    req = Request(
        url,
        data=json.dumps(definition).encode(),
        headers={
            "Content-Type": "application/json",
            "X-Api-Key": api_key,
        },
        method="POST",
    )

    try:
        with urlopen(req) as resp:
            body = json.loads(resp.read())
            print(f"Registered: {body.get('name')} v{body.get('version')}")
    except HTTPError as e:
        error_body = e.read().decode()
        print(f"Error {e.code}: {error_body}")
        sys.exit(1)

    # Also start an instance so we can test the cowork flow
    print("\nStarting instance...")
    start_url = f"{base_url}/api/processes"
    start_req = Request(
        start_url,
        data=json.dumps({
            "definitionName": definition["name"],
            "definitionVersion": definition["version"],
            "triggeredBy": "seed-script",
        }).encode(),
        headers={
            "Content-Type": "application/json",
            "X-Api-Key": api_key,
        },
        method="POST",
    )

    try:
        with urlopen(start_req) as resp:
            body = json.loads(resp.read())
            instance_id = body.get("instanceId") or body.get("id")
            status = body.get("status")
            print(f"Instance: {instance_id} (status: {status})")

            if instance_id:
                # Trigger auto-runner to create CoworkSession
                run_url = f"{base_url}/api/processes/{instance_id}/run"
                run_req = Request(
                    run_url,
                    data=json.dumps({"triggeredBy": "seed-script"}).encode(),
                    headers={
                        "Content-Type": "application/json",
                        "X-Api-Key": api_key,
                    },
                    method="POST",
                )
                with urlopen(run_req) as run_resp:
                    run_body = json.loads(run_resp.read())
                    print(f"Auto-runner: status={run_body.get('status')}, currentStep={run_body.get('currentStepId')}")
                    print(f"\nDone! Check Firestore for a CoworkSession linked to instance {instance_id}")
    except HTTPError as e:
        error_body = e.read().decode()
        print(f"Error {e.code}: {error_body}")
        sys.exit(1)


if __name__ == "__main__":
    main()
