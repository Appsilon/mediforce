#!/usr/bin/env python3
"""
Seed the Step-2 MCP tool catalog into the Firestore emulator.

Writes to namespaces/{handle}/toolCatalog/{id}. Re-runnable: each PATCH
replaces the doc by id (no duplicates).

Dev-only: targets the Firestore emulator via its REST API (no auth).
For non-emulator environments, wait for platform-ui startup — it
auto-seeds via seedBuiltinToolCatalog in platform-services.ts.

Usage:
    # With emulators running (firebase emulators:start)
    FIRESTORE_EMULATOR_HOST=localhost:8080 \\
    python3 scripts/seed_tool_catalog.py

    # Or pass host via flag
    python3 scripts/seed_tool_catalog.py --emulator-host localhost:8080
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

DEFAULT_PROJECT_ID = "demo-mediforce"

# Each entry mirrors ToolCatalogEntry and is keyed by the namespace it
# belongs to. Keep this in sync with
# packages/platform-ui/src/lib/seed-tool-catalog.ts (single source of
# truth per Step 2 — duplication reviewed via PR).
CATALOG: dict[str, list[dict[str, Any]]] = {
    "appsilon": [
        {
            "id": "tealflow-mcp",
            "command": "tealflow-mcp",
            "description": (
                "Tealflow MCP — lists and describes available teal modules "
                "for clinical trial data exploration."
            ),
        },
    ],
}


def _typed_value(value: Any) -> dict[str, Any]:
    """Encode a Python value as a Firestore REST `fields` entry.
    Supports the subset needed by ToolCatalogEntry: string, list[string],
    dict[string, string]. Extend cautiously — keep the surface small. """
    if isinstance(value, str):
        return {"stringValue": value}
    if isinstance(value, list):
        return {"arrayValue": {"values": [_typed_value(v) for v in value]}}
    if isinstance(value, dict):
        return {
            "mapValue": {
                "fields": {k: _typed_value(v) for k, v in value.items()},
            },
        }
    raise TypeError(f"Unsupported value type for Firestore encode: {type(value)}")


def _encode_fields(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "fields": {k: _typed_value(v) for k, v in entry.items() if k != "id"},
    }


def _upsert(
    emulator_host: str,
    project_id: str,
    namespace: str,
    entry: dict[str, Any],
) -> None:
    entry_id = entry["id"]
    url = (
        f"http://{emulator_host}/v1/projects/{project_id}/databases/(default)/documents/"
        f"namespaces/{namespace}/toolCatalog/{entry_id}"
    )
    payload = json.dumps(_encode_fields(entry)).encode()
    req = Request(url, data=payload, method="PATCH", headers={"Content-Type": "application/json"})
    try:
        with urlopen(req) as resp:
            resp.read()
    except HTTPError as e:
        detail = e.read().decode(errors="replace")
        print(f"Error upserting {namespace}/{entry_id}: HTTP {e.code} — {detail}", file=sys.stderr)
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

    total = 0
    for namespace, entries in CATALOG.items():
        for entry in entries:
            _upsert(args.emulator_host, args.project_id, namespace, entry)
            print(f"Upserted namespaces/{namespace}/toolCatalog/{entry['id']}")
            total += 1
    print(f"Done: {total} catalog entries seeded.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
