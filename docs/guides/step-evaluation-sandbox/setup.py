"""Install the AE-grading evaluation sandbox into a workspace through the mediforce CLI.

Registers the `ctcae-reference` Tool Catalog entry, the `AE Grader` agent and the
`ae-grading-eval-sandbox` workflow. Entries that already exist are reused, so a
second run only registers a new workflow version.

    python3 docs/guides/step-evaluation-sandbox/setup.py --namespace db

Needs a running platform and MEDIFORCE_API_KEY in the environment.
"""

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).parent
REPO_ROOT = HERE.parents[2]
CATALOG_ID = "ctcae-reference"
AGENT_NAME = "AE Grader"


def mediforce(*args: str) -> dict:
    completed = subprocess.run(
        ["pnpm", "exec", "mediforce", *args, "--json"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        sys.exit(f"mediforce {' '.join(args)} failed:\n{completed.stdout}{completed.stderr}")
    return json.loads(completed.stdout)


def write_temp_json(payload: dict) -> str:
    handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    json.dump(payload, handle, indent=2)
    handle.close()
    return handle.name


def ensure_tool_catalog_entry(namespace: str) -> None:
    entries = mediforce("tool-catalog", "list", "--namespace", namespace)["entries"]
    if any(entry["id"] == CATALOG_ID for entry in entries):
        print(f"Tool Catalog entry '{CATALOG_ID}' already exists — reused")
        return
    entry = {
        "id": CATALOG_ID,
        "command": "python3",
        "args": ["-c", (HERE / "ctcae_mcp.py").read_text()],
        "description": "CTCAE v5.0 term reference, lab reference ranges and a (simulated) expedited safety report filing tool. Self-contained stdio MCP server for the AE grading evaluation sandbox.",
    }
    mediforce("tool-catalog", "add", "--file", write_temp_json(entry), "--namespace", namespace)
    print(f"Tool Catalog entry '{CATALOG_ID}' added")


def ensure_agent(namespace: str) -> str:
    for agent in mediforce("agent", "list")["agents"]:
        if agent["name"] == AGENT_NAME and agent.get("namespace") == namespace:
            print(f"Agent '{AGENT_NAME}' already exists ({agent['id']}) — reused")
            return agent["id"]
    created = mediforce("agent", "create", "--file", str(HERE / "agent.json"), "--namespace", namespace)
    agent_id = created["agent"]["id"]
    print(f"Agent '{AGENT_NAME}' created ({agent_id})")
    return agent_id


def register_workflow(namespace: str, agent_id: str) -> None:
    definition = json.loads((HERE / "workflow.json").read_text())
    for step in definition["steps"]:
        if step.get("agentId") == "__AGENT_ID__":
            step["agentId"] = agent_id
    registered = mediforce("workflow", "register", "--file", write_temp_json(definition), "--namespace", namespace)
    print(f"Workflow '{registered['name']}' registered as v{registered['version']}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--namespace", default="db", help="Workspace handle (default: db)")
    namespace = parser.parse_args().namespace
    ensure_tool_catalog_entry(namespace)
    register_workflow(namespace, ensure_agent(namespace))
    print(f"\nNext: set the OPENROUTER_API_KEY workspace secret, then start the samples — see step-evaluation-manual-test.md")


if __name__ == "__main__":
    main()
