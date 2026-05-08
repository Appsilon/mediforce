#!/usr/bin/env python3
"""
Migrate apps/tealflow-cowork/src/tealflow-cowork.wd.json from legacy
step-level cowork.mcpServers to the Step-2 agent-centric model.

Before:
    cowork: {
      agent: 'chat',
      mcpServers: [{ name: 'tealflow', command: 'tealflow-mcp', ... }]
    }

After:
    agentId: 'tealflow-cowork-chat'
    cowork: {
      agent: 'chat'
    }

The AgentDefinition with id 'tealflow-cowork-chat' and the ToolCatalog
entry 'tealflow-mcp' are seeded by companion scripts:
    scripts/seed_tool_catalog.py
    scripts/seed_agent_definitions.py

Idempotent: running twice is safe. If the step already carries agentId
and has no cowork.mcpServers, the file is left untouched.

Usage:
    python3 scripts/migrate_tealflow_cowork_mcp.py

Exits 0 on success (migrated or already-migrated), 1 on any error.
"""

import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).parent.parent
WD_PATH = REPO_ROOT / "apps" / "tealflow-cowork" / "src" / "tealflow-cowork.wd.json"
AGENT_ID = "tealflow-cowork-chat"
EXPECTED_MCP_SERVER_NAME = "tealflow"
EXPECTED_COMMAND = "tealflow-mcp"


def migrate_step(step: dict[str, Any]) -> bool:
    """Return True if the step was modified, False if no-op."""
    if step.get("executor") != "cowork":
        return False

    cowork = step.get("cowork")
    if not isinstance(cowork, dict):
        return False

    legacy_servers = cowork.get("mcpServers")
    already_has_agent_id = "agentId" in step

    # Already migrated and legacy field cleaned: nothing to do.
    if already_has_agent_id and legacy_servers is None:
        return False

    # Safety: verify the legacy payload is the shape we expect before touching it.
    if legacy_servers is not None:
        if not isinstance(legacy_servers, list) or len(legacy_servers) != 1:
            raise RuntimeError(
                f"Step {step.get('id')!r}: expected exactly one entry in "
                f"cowork.mcpServers, got {legacy_servers!r}"
            )
        server = legacy_servers[0]
        if server.get("name") != EXPECTED_MCP_SERVER_NAME or server.get("command") != EXPECTED_COMMAND:
            raise RuntimeError(
                f"Step {step.get('id')!r}: legacy cowork.mcpServers does not "
                f"match the expected tealflow-mcp entry, refusing to migrate: {server!r}"
            )
        del cowork["mcpServers"]

    if not already_has_agent_id:
        # Insert agentId near the top of the step for readability — after id/name/type/executor.
        ordered: dict[str, Any] = {}
        for key in ("id", "name", "type", "executor"):
            if key in step:
                ordered[key] = step[key]
        ordered["agentId"] = AGENT_ID
        for key, value in step.items():
            if key not in ordered:
                ordered[key] = value
        step.clear()
        step.update(ordered)

    return True


def main() -> int:
    if not WD_PATH.exists():
        print(f"Error: workflow definition not found at {WD_PATH}", file=sys.stderr)
        return 1

    with WD_PATH.open("r", encoding="utf-8") as f:
        wd = json.load(f)

    steps = wd.get("steps")
    if not isinstance(steps, list):
        print("Error: wd.json has no steps array", file=sys.stderr)
        return 1

    changed_ids: list[str] = []
    for step in steps:
        if migrate_step(step):
            changed_ids.append(step.get("id", "<unknown>"))

    if not changed_ids:
        print(f"No changes: {WD_PATH.name} already matches Step 2 shape.")
        return 0

    with WD_PATH.open("w", encoding="utf-8") as f:
        json.dump(wd, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"Migrated steps in {WD_PATH.name}: {', '.join(changed_ids)}")
    print(
        f"Remember to seed AgentDefinition '{AGENT_ID}' and "
        f"ToolCatalog entry '{EXPECTED_COMMAND}' in the target namespace."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
