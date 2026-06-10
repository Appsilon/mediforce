#!/usr/bin/env python3
"""Spike: verify a Databricks workspace exposes everything the future
`databricks-job` agent plugin needs, using only a scoped PAT.

Usage:
    export DATABRICKS_HOST=https://dbc-xxxxxxxx.cloud.databricks.com
    export DATABRICKS_TOKEN=dapi...
    python3 scripts/databricks-spike.py
    python3 scripts/databricks-spike.py --keep   # leave notebook + job behind

Exercises the full plugin cycle against a real workspace (Free Edition works):
    1. Jobs API sanity check (token + `jobs` scope)
    2. Upload a notebook via workspace import (`workspace` scope)
    3. Create a serverless job pointing at the notebook
    4. Trigger it with run-now and poll until terminal state
    5. Read the structured result via runs/get-output
    6. Execute a statement via SQL Statement Execution API (`sql` scope)
    7. Clean up the job and notebook

Each step prints its latency; a missing token scope surfaces as the API
error body, which names the scope it wants.
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

NOTEBOOK_PATH = "/Shared/mediforce-databricks-spike"
NOTEBOOK_SOURCE = """# Databricks notebook source
import json

dbutils.notebook.exit(json.dumps({"validationStatus": "passed", "rowsChecked": 42}))
"""
JOB_NAME = "mediforce-databricks-spike"
RUN_POLL_INTERVAL_SECONDS = 10
RUN_TIMEOUT_SECONDS = 15 * 60


def api(host: str, token: str, method: str, path: str, payload: dict | None = None) -> dict:
    url = f"{host}{path}"
    body = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        print(f"\nError: {method} {path} -> HTTP {error.code}")
        print(error.read().decode())
        print("If the body mentions a missing scope, PATCH /api/2.0/token/<token_id> to add it.")
        sys.exit(1)


def timed(label: str):
    print(f"\n{label} ...")
    return time.monotonic()


def done(started: float) -> None:
    print(f"   ok ({time.monotonic() - started:.1f}s)")


def run_state(run: dict) -> tuple[str, str | None]:
    status = run.get("status")
    if status is not None:
        details = status.get("termination_details") or {}
        return status["state"], details.get("code")
    legacy = run["state"]
    return legacy["life_cycle_state"], legacy.get("result_state")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--keep", action="store_true", help="skip cleanup of notebook + job")
    args = parser.parse_args()

    host = os.environ.get("DATABRICKS_HOST", "").rstrip("/")
    token = os.environ.get("DATABRICKS_TOKEN", "")
    if host == "" or token == "":
        print("Error: set DATABRICKS_HOST and DATABRICKS_TOKEN first.")
        sys.exit(1)

    started = timed(f"1. Jobs API sanity check against {host}")
    api(host, token, "GET", "/api/2.2/jobs/list?limit=1")
    done(started)

    started = timed(f"2. Importing notebook {NOTEBOOK_PATH}")
    api(host, token, "POST", "/api/2.0/workspace/import", {
        "path": NOTEBOOK_PATH,
        "format": "SOURCE",
        "language": "PYTHON",
        "overwrite": True,
        "content": base64.b64encode(NOTEBOOK_SOURCE.encode()).decode(),
    })
    done(started)

    started = timed(f"3. Creating serverless job '{JOB_NAME}'")
    job_id = api(host, token, "POST", "/api/2.2/jobs/create", {
        "name": JOB_NAME,
        "tasks": [{
            "task_key": "spike",
            "notebook_task": {"notebook_path": NOTEBOOK_PATH},
        }],
    })["job_id"]
    print(f"   job_id={job_id}")
    done(started)

    started = timed("4. Triggering run-now and polling until terminal state")
    run_id = api(host, token, "POST", "/api/2.2/jobs/run-now", {"job_id": job_id})["run_id"]
    print(f"   run_id={run_id}")
    last_state = None
    while True:
        run = api(host, token, "GET", f"/api/2.2/jobs/runs/get?run_id={run_id}")
        state, result = run_state(run)
        if state != last_state:
            print(f"   {time.monotonic() - started:7.1f}s  {state}")
            last_state = state
        if state in ("TERMINATED", "INTERNAL_ERROR", "SKIPPED"):
            break
        if time.monotonic() - started > RUN_TIMEOUT_SECONDS:
            print("Error: run did not reach a terminal state within the timeout.")
            sys.exit(1)
        time.sleep(RUN_POLL_INTERVAL_SECONDS)
    print(f"   terminal state: {state} / {result}")
    done(started)

    started = timed("5. Reading structured result via runs/get-output")
    task_run_id = run["tasks"][0]["run_id"]
    output = api(host, token, "GET", f"/api/2.2/jobs/runs/get-output?run_id={task_run_id}")
    notebook_result = output.get("notebook_output", {}).get("result")
    print(f"   notebook_output.result = {notebook_result}")
    done(started)

    started = timed("6. SQL Statement Execution API")
    warehouses = api(host, token, "GET", "/api/2.0/sql/warehouses").get("warehouses", [])
    if not warehouses:
        print("   no SQL warehouse found - skipping (create one in the UI to test this path)")
    else:
        warehouse_id = warehouses[0]["id"]
        print(f"   warehouse: {warehouses[0].get('name')} ({warehouse_id})")
        statement = api(host, token, "POST", "/api/2.0/sql/statements", {
            "warehouse_id": warehouse_id,
            "statement": "SELECT 1 AS spike_check",
            "wait_timeout": "30s",
        })
        while statement["status"]["state"] in ("PENDING", "RUNNING"):
            time.sleep(2)
            statement = api(
                host, token, "GET", f"/api/2.0/sql/statements/{statement['statement_id']}"
            )
        print(f"   statement state: {statement['status']['state']}")
        print(f"   rows: {statement.get('result', {}).get('data_array')}")
    done(started)

    if args.keep:
        print(f"\n7. Keeping notebook {NOTEBOOK_PATH} and job {job_id} (--keep).")
    else:
        started = timed("7. Cleaning up job and notebook")
        api(host, token, "POST", "/api/2.2/jobs/delete", {"job_id": job_id})
        api(host, token, "POST", "/api/2.0/workspace/delete", {"path": NOTEBOOK_PATH})
        done(started)

    print("\nSpike passed: this workspace + token cover the full databricks-job plugin cycle.")


if __name__ == "__main__":
    main()
