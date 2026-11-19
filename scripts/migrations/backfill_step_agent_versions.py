#!/usr/bin/env python3
"""
Pin workflow steps saved before step-level Agent version pinning (ADR-0029) to
their Agent's current version.

A step saved before pinning names an `agentId` with no `agentVersion` key, so it
keeps tracking its Agent live. A step saved since carries the version picked
with its Agent, or `null` when its author chose "Track current"; both are left
alone. Steps are immutable per Workflow Definition version, so each affected
workflow gets a new version registered through `mediforce workflow register`,
the normal save path.

The version pinned is the one the step editor would pin on picking the Agent
today: the Agent's current version. An Agent edited since its newest recorded
version has none, so its steps stay unpinned and are reported; saving that
Agent once records its version, and a re-run pins them.

The version rewritten is the workflow's latest live one, so the new version
only adds pins on top of what editors already see. A default that pointed at it
moves to the new version; an archived default is left, since runs already fall
back to the newest live version. A workflow whose default is a live version
older than its latest is reported and skipped: pinning the default would bury
the newer version, pinning the latest would not change what runs. Runs already
started keep the version they started on.

    # Rehearse: validates and writes the rewritten definitions, registers nothing.
    MEDIFORCE_BASE_URL=https://staging.mediforce.ai MEDIFORCE_API_KEY=... \\
        python3 scripts/migrations/backfill_step_agent_versions.py \\
        --out-dir /tmp/agent-version-backfill --dry-run

    # Apply. --namespace (repeatable) limits it to some workspaces.
    MEDIFORCE_BASE_URL=https://staging.mediforce.ai MEDIFORCE_API_KEY=... \\
        python3 scripts/migrations/backfill_step_agent_versions.py \\
        --out-dir /tmp/agent-version-backfill

It covers only the workflows the API key's user can see, so run it with a key
whose user is a member of every workspace to cover them all. Re-runnable: a
workflow whose steps are all pinned or deliberately live is skipped, and a
workflow that fails is reported without stopping the others.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SERVER_MANAGED_FIELDS = ("version", "createdAt", "namespace", "archived", "deleted", "copiedFrom")


class BackfillError(Exception):
    pass


def mediforce_json(*arguments: str) -> dict:
    result = subprocess.run(["pnpm", "--silent", "exec", "mediforce", *arguments, "--json"],
                            cwd=REPO_ROOT, capture_output=True, text=True)
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip()
        try:
            message = json.loads(message)["error"]
        except (ValueError, KeyError, TypeError):
            pass
        raise BackfillError(f"mediforce {' '.join(arguments[:2])}: {message}")
    return json.loads(result.stdout)


class AgentVersions:
    """Each Agent's current version, read once, or why it has none."""

    def __init__(self) -> None:
        self.cache: dict[str, int | str] = {}

    def of(self, agent_id: str) -> int | str:
        if agent_id not in self.cache:
            try:
                current = mediforce_json("agent", "versions", agent_id)["current"]
            except BackfillError as error:
                current = str(error)
            self.cache[agent_id] = current if current is not None else \
                "changed since its newest recorded version; save it once, then re-run"
        return self.cache[agent_id]


def is_unpinned(step: dict) -> bool:
    return step.get("agentId") is not None and "agentVersion" not in step


def pin_steps(definition: dict, agents: AgentVersions) -> tuple[list[str], list[str]]:
    """Pin each unpinned step in place; returns what was pinned and what could not be."""
    pinned: list[str] = []
    unpinnable: list[str] = []
    for step in definition["steps"]:
        if is_unpinned(step) is False:
            continue
        agent_id = step["agentId"]
        version = agents.of(agent_id)
        if isinstance(version, str):
            unpinnable.append(f"{step['id']} ({agent_id}: {version})")
            continue
        step["agentVersion"] = version
        pinned.append(f"{step['id']} -> {agent_id} v{version}")
    return pinned, unpinnable


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out-dir", required=True, help="Where rewritten definitions are written")
    parser.add_argument("--namespace", action="append", default=[], help="Limit to a workspace (repeatable; default: all visible)")
    parser.add_argument("--dry-run", action="store_true", help="Rewrite and validate only; register nothing")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    agents = AgentVersions()
    failures: list[str] = []
    backfilled = 0

    try:
        groups = mediforce_json("workflow", "list")["definitions"]
    except BackfillError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    for group in groups:
        namespace, name = group["namespace"], group["name"]
        latest = group["definition"]
        if len(args.namespace) > 0 and namespace not in args.namespace:
            continue
        if latest is None or any(map(is_unpinned, latest["steps"])) is False:
            continue
        label = f"{namespace}/{name} v{latest['version']}"
        default_version = group["defaultVersion"]
        try:
            if default_version is not None and default_version != latest["version"]:
                default = mediforce_json("workflow", "get", name, "--namespace", namespace, "--version", str(default_version))
                if default.get("archived") is not True:
                    failures.append(f"{label}: skipped, its default v{default_version} is older; pin the version that should run by hand")
                    continue

            definition = {key: value for key, value in latest.items() if key not in SERVER_MANAGED_FIELDS}
            pinned, unpinnable = pin_steps(definition, agents)
            if len(unpinnable) > 0:
                failures.append(f"{label}: left unpinned: " + "; ".join(unpinnable))
            if len(pinned) == 0:
                continue

            target = out_dir / namespace / f"{name}.wd.json"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(definition, indent=2) + "\n")
            print(f"{label} -> {target}")
            for change in pinned:
                print(f"    {change}")
            if args.dry_run:
                mediforce_json("workflow", "register", "--file", str(target), "--namespace", namespace, "--dry-run")
                backfilled += 1
                continue

            registered = mediforce_json("workflow", "register", "--file", str(target), "--namespace", namespace)["version"]
            print(f"    registered v{registered}")
            backfilled += 1
            if default_version == latest["version"]:
                try:
                    mediforce_json("workflow", "set-default-version", name, "--namespace", namespace, "--version", str(registered))
                except BackfillError as error:
                    failures.append(f"{label}: registered v{registered} but its default stays v{default_version}; "
                                    f"run `mediforce workflow set-default-version {name} --namespace {namespace} "
                                    f"--version {registered}` ({error})")
                    continue
                print(f"    default moved v{default_version} -> v{registered}")
        except BackfillError as error:
            failures.append(f"{label}: {error}")

    if len(failures) > 0:
        print("\nNot fully pinned:", file=sys.stderr)
        for failure in failures:
            print(f"  {failure}", file=sys.stderr)
    verb = "would be backfilled" if args.dry_run else "backfilled"
    print(f"\n{backfilled} workflow(s) {verb}, {len(failures)} with problems.")
    return 0 if len(failures) == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
