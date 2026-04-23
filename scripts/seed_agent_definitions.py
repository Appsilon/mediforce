#!/usr/bin/env python3
"""
Seed Step-2 AgentDefinitions into the Firestore emulator.

Writes to agentDefinitions/{id} at deterministic slugs so
WorkflowStep.agentId references stay stable across environments.
Re-runnable: each PATCH replaces the doc by id.

Dev-only: targets the Firestore emulator via its REST API (no auth).
For non-emulator environments, rely on platform-ui's startup seed
(seedBuiltinAgentDefinitions in platform-services.ts).

Source data: data/seeds/agent-definitions.json (shared with the TS seed
in packages/platform-ui/src/lib/seed-agent-definitions.ts).

Usage:
    FIRESTORE_EMULATOR_HOST=localhost:8080 \\
    python3 scripts/seed_agent_definitions.py

    python3 scripts/seed_agent_definitions.py --emulator-host localhost:8080
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

DEFAULT_PROJECT_ID = "demo-mediforce"

REPO_ROOT = Path(__file__).parent.parent
SEED_PATH = REPO_ROOT / "data" / "seeds" / "agent-definitions.json"


def _load_agent_definitions() -> dict[str, dict[str, Any]]:
    with SEED_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def _typed_value(value: Any) -> dict[str, Any]:
    """Encode a Python value as a Firestore REST `fields` entry."""
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    if isinstance(value, str):
        return {"stringValue": value}
    if isinstance(value, list):
        return {"arrayValue": {"values": [_typed_value(v) for v in value]}}
    if isinstance(value, dict):
        return {"mapValue": {"fields": {k: _typed_value(v) for k, v in value.items()}}}
    raise TypeError(f"Unsupported value type for Firestore encode: {type(value)}")


def _encode_fields(entry: dict[str, Any]) -> dict[str, Any]:
    return {"fields": {k: _typed_value(v) for k, v in entry.items()}}


def _upsert(
    emulator_host: str,
    project_id: str,
    doc_id: str,
    entry: dict[str, Any],
) -> None:
    url = (
        f"http://{emulator_host}/v1/projects/{project_id}/databases/(default)/documents/"
        f"agentDefinitions/{doc_id}"
    )
    now_iso = datetime.now(tz=timezone.utc).isoformat()
    payload = {**entry, "createdAt": now_iso, "updatedAt": now_iso}
    req = Request(
        url,
        data=json.dumps(_encode_fields(payload)).encode(),
        method="PATCH",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(req) as resp:
            resp.read()
    except HTTPError as e:
        detail = e.read().decode(errors="replace")
        print(f"Error upserting agentDefinitions/{doc_id}: HTTP {e.code} — {detail}", file=sys.stderr)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--emulator-host",
        default=os.environ.get("FIRESTORE_EMULATOR_HOST", "localhost:8080"),
        help="Firestore emulator host (default: $FIRESTORE_EMULATOR_HOST or localhost:8080)",
    )
    parser.add_argument(
        "--project-id",
        default=os.environ.get("GOOGLE_CLOUD_PROJECT", DEFAULT_PROJECT_ID),
        help=f"Firebase project id (default: $GOOGLE_CLOUD_PROJECT or {DEFAULT_PROJECT_ID})",
    )
    args = parser.parse_args()

    agent_definitions = _load_agent_definitions()
    for doc_id, entry in agent_definitions.items():
        _upsert(args.emulator_host, args.project_id, doc_id, entry)
        print(f"Upserted agentDefinitions/{doc_id}")
    print(f"Done: {len(agent_definitions)} agent definitions seeded.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
