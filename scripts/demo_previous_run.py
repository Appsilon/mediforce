#!/usr/bin/env python3
"""Live demo for the previous-run-outputs feature — PR #217 / issue #211.

Drives three chain links through the HTTP API, showing a user-typed message
flowing from one run into the next:

    1. Register a fresh copy of `docs/examples/previous-run-example.wd.json`
       (script step runs in Docker; human step renders a params form).
    2. Run 1 — auto-runner executes the script step (reads /output/previous_run.json,
       writes a summary), then pauses on the human form. Submit `{ message: "from run 1" }`.
    3. Run 2 — `previousRun` should equal `{ message: "from run 1" }` with source set
       to run 1. Submit `{ message: "from run 2" }`.
    4. Run 3 — `previousRun` chains forward to `{ message: "from run 2" }`.

Requirements:
    - Dev server at http://localhost:9003 with NEXT_PUBLIC_USE_EMULATORS=true
      (or MEDIFORCE_URL pointing elsewhere + MEDIFORCE_API_KEY set).
    - Docker running (script step pulls python:3.12-slim the first time).
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
WD_PATH = ROOT / "docs" / "examples" / "previous-run-example.wd.json"

BASE = os.environ.get("MEDIFORCE_URL", "http://localhost:9003").rstrip("/")
API_KEY = os.environ.get("MEDIFORCE_API_KEY", os.environ.get("PLATFORM_API_KEY", "test-api-key"))
NAMESPACE = os.environ.get("MEDIFORCE_NAMESPACE", "test")
# Script step needs longer than the usual poll budget because Docker may have
# to pull python:3.12-slim on the first run (~20MB).
POLL_TIMEOUT_S = 90.0
POLL_INTERVAL_S = 0.5


def api(method: str, path: str, body: Any = None) -> Any:
    data = json.dumps(body).encode() if body is not None else None
    req = Request(
        f"{BASE}{path}",
        data=data,
        method=method,
        headers={"X-Api-Key": API_KEY, "Content-Type": "application/json"},
    )
    try:
        with urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else {}
    except HTTPError as err:
        body_text = err.read().decode()
        raise SystemExit(f"HTTP {err.code} on {method} {path}: {body_text}") from err


def poll(check, description: str):
    deadline = time.time() + POLL_TIMEOUT_S
    while time.time() < deadline:
        result = check()
        if result is not None:
            return result
        time.sleep(POLL_INTERVAL_S)
    raise SystemExit(f"Timed out waiting for: {description}")


def trigger_run(wd_name: str) -> str:
    resp = api("POST", "/api/processes", {
        "definitionName": wd_name,
        "triggeredBy": "demo",
        "triggerName": "Start",
    })
    return resp["instanceId"]


def wait_for_form_task(instance_id: str, step_id: str) -> dict:
    return poll(
        lambda: next(
            (t for t in api("GET", f"/api/tasks?instanceId={instance_id}")["tasks"]
             if t["stepId"] == step_id and t["status"] != "completed"),
            None,
        ),
        f"form task on `{step_id}` for {instance_id}",
    )


def submit_form(task_id: str, param_values: dict) -> None:
    api("POST", f"/api/tasks/{task_id}/resolve", {"paramValues": param_values})


def wait_completed(instance_id: str) -> dict:
    return poll(
        lambda: (lambda r: r if r["status"] == "completed" else None)(
            api("GET", f"/api/processes/{instance_id}")
        ),
        f"{instance_id} to complete",
    )


def main() -> None:
    # Fresh name per invocation so reruns are independent chains.
    wd_spec = json.loads(WD_PATH.read_text())
    wd_spec.pop("_comment", None)
    wd_spec["name"] = f"previous-run-demo-{uuid.uuid4().hex[:8]}"

    print(f"→ Registering WD `{wd_spec['name']}` in namespace `{NAMESPACE}`")
    registered = api("POST", f"/api/workflow-definitions?namespace={NAMESPACE}", wd_spec)
    print(f"  ok — version {registered['version']}")

    wd_name = wd_spec["name"]

    # ─── Run 1 — no predecessor, operator types "from run 1" ────────────────
    print("→ Triggering run 1")
    run1_id = trigger_run(wd_name)
    print(f"  instanceId = {run1_id}")

    run1 = api("GET", f"/api/processes/{run1_id}")
    print(f"  previousRun on arrival: {run1.get('previousRun')} "
          f"(expected `{{}}`, no predecessor), "
          f"previousRunSourceId={run1.get('previousRunSourceId')}")

    task1 = wait_for_form_task(run1_id, "set-next")
    submit_form(task1["id"], {"message": "from run 1"})
    wait_completed(run1_id)
    print("  run 1 completed ✓ (typed 'from run 1')")

    # ─── Run 2 — should see run 1's message; operator types "from run 2" ────
    print("→ Triggering run 2")
    run2_id = trigger_run(wd_name)
    print(f"  instanceId = {run2_id}")

    run2 = api("GET", f"/api/processes/{run2_id}")
    print(f"  previousRun: {run2.get('previousRun')} | sourceId={run2.get('previousRunSourceId')}")
    assert run2.get("previousRun") == {"message": "from run 1"}, run2
    assert run2.get("previousRunSourceId") == run1_id, run2

    task2 = wait_for_form_task(run2_id, "set-next")
    submit_form(task2["id"], {"message": "from run 2"})
    wait_completed(run2_id)
    print("  run 2 completed ✓ (typed 'from run 2')")

    # ─── Run 3 — chain advances forward ─────────────────────────────────────
    print("→ Triggering run 3")
    run3_id = trigger_run(wd_name)
    run3 = api("GET", f"/api/processes/{run3_id}")
    print(f"  previousRun: {run3.get('previousRun')} | sourceId={run3.get('previousRunSourceId')}")

    expected = {"message": "from run 2"}
    ok = run3.get("previousRun") == expected and run3.get("previousRunSourceId") == run2_id
    if ok:
        print(f"✓ PASS — chain advanced: run 3 sees run 2's message, source points to run 2")
        sys.exit(0)
    else:
        print(
            f"✗ FAIL — previousRun={run3.get('previousRun')} (expected {expected}), "
            f"previousRunSourceId={run3.get('previousRunSourceId')} (expected {run2_id})"
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
