#!/usr/bin/env python3
"""
Seed Step-2 AgentDefinitions into the Firestore emulator.

Writes to agentDefinitions/{id} at deterministic slugs so
WorkflowStep.agentId references stay stable across environments.
Re-runnable: each PATCH replaces the doc by id.

Dev-only: targets the Firestore emulator via its REST API (no auth).
For non-emulator environments, rely on platform-ui's startup seed
(seedBuiltinAgentDefinitions in platform-services.ts).

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
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

DEFAULT_PROJECT_ID = "demo-mediforce"

# Keep these entries in sync with
# packages/platform-ui/src/lib/seed-agent-definitions.ts.
# The TS seed is authoritative for non-emulator environments; this
# script primes the emulator so a fresh dev box can be readied before
# platform-ui starts.
AGENT_DEFINITIONS: dict[str, dict[str, Any]] = {
    "claude-code-agent": {
        "kind": "plugin",
        "runtimeId": "claude-code-agent",
        "name": "Claude Code Agent",
        "iconName": "Bot",
        "description": (
            "Executes code generation, analysis, and automated software "
            "tasks using Claude's advanced coding capabilities."
        ),
        "inputDescription": "Task description and relevant code context",
        "outputDescription": "Generated code, analysis results, or task completion report",
        "foundationModel": "anthropic/claude-sonnet-4",
        "systemPrompt": "",
        "skillFileNames": [],
    },
    "opencode-agent": {
        "kind": "plugin",
        "runtimeId": "opencode-agent",
        "name": "OpenCode Agent",
        "iconName": "Cpu",
        "description": (
            "Open-source code execution agent powered by DeepSeek for "
            "cost-efficient automated development tasks."
        ),
        "inputDescription": "Code task description and project context",
        "outputDescription": "Implemented code changes and execution results",
        "foundationModel": "deepseek/deepseek-chat",
        "systemPrompt": "",
        "skillFileNames": [],
    },
    "script-container": {
        "kind": "plugin",
        "runtimeId": "script-container",
        "name": "Script Container",
        "iconName": "Terminal",
        "description": (
            "Sandboxed execution environment for running custom scripts, "
            "data transformations, and automation tasks."
        ),
        "inputDescription": "Script definition and input parameters",
        "outputDescription": "Script execution output and exit status",
        "foundationModel": "anthropic/claude-sonnet-4",
        "systemPrompt": "",
        "skillFileNames": [],
    },
    "supply-intelligence-driver-agent": {
        "kind": "plugin",
        "runtimeId": "supply-intelligence/driver-agent",
        "name": "Driver Agent",
        "iconName": "Chart",
        "description": (
            "Orchestrates multi-step supply chain review workflows by "
            "coordinating data collection, analysis, and reporting agents."
        ),
        "inputDescription": "Workflow trigger payload with study identifiers",
        "outputDescription": "Completed workflow result with step summaries",
        "foundationModel": "anthropic/claude-sonnet-4",
        "systemPrompt": "",
        "skillFileNames": [],
    },
    "supply-intelligence-risk-detection": {
        "kind": "plugin",
        "runtimeId": "supply-intelligence/risk-detection",
        "name": "Risk Detection",
        "iconName": "Chart",
        "description": (
            "Analyzes vendor submissions and supply chain data to identify "
            "potential risks, anomalies, and compliance issues."
        ),
        "inputDescription": "Vendor submission records and historical data",
        "outputDescription": "Risk scores, flagged issues, and recommendations",
        "foundationModel": "anthropic/claude-sonnet-4",
        "systemPrompt": "",
        "skillFileNames": [],
    },
    # Per-workflow AgentDefinition referenced by tealflow-cowork.wd.json.
    "tealflow-cowork-chat": {
        "kind": "cowork",
        "runtimeId": "chat",
        "name": "Tealflow Cowork Chat",
        "iconName": "MessageCircle",
        "description": (
            "Chat cowork agent with the tealflow MCP server attached for "
            "teal module exploration."
        ),
        "inputDescription": "User messages and artifact state",
        "outputDescription": "Teal module selection artifact",
        "foundationModel": "anthropic/claude-sonnet-4",
        "systemPrompt": "",
        "skillFileNames": [],
        "mcpServers": {
            "tealflow": {"type": "stdio", "catalogId": "tealflow-mcp"},
        },
    },
}


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

    for doc_id, entry in AGENT_DEFINITIONS.items():
        _upsert(args.emulator_host, args.project_id, doc_id, entry)
        print(f"Upserted agentDefinitions/{doc_id}")
    print(f"Done: {len(AGENT_DEFINITIONS)} agent definitions seeded.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
