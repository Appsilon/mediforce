#!/usr/bin/env python3
"""
Pin workflow steps saved before step-level Agent version pinning (ADR-0029) to
their Agent's current version.

A step saved before pinning (#1674) names an `agentId` with no `agentVersion`
key, so it keeps tracking its Agent live. A step saved since carries the version
picked with its Agent, or `null` when its author chose "Track current"; both are
left alone. A step saved since whose Agent had no current version also lacks the
key, so this script cannot tell it from an old one and pins it. Steps are
immutable per Workflow Definition version, so each affected workflow gets a new
version registered through `mediforce workflow register`, the normal save path.

The version pinned is the one the step editor would pin on picking the Agent
today: the Agent's current version. An Agent edited since its newest recorded
version has none, so its steps stay unpinned and are reported; saving that
Agent once records its version, and a re-run pins them.

The workflow's latest live version is rewritten, and a default that pointed at
it moves to the new version, as "save and set as default" does. A workflow whose
default is an older live version is reported and skipped, so what runs never
changes silently, and so is one whose head is pinned but whose older live
default is not; an archived default stays as it is. A workflow saved or
re-defaulted after it was listed is skipped rather than overwritten; re-run to
pick it up. Runs already started keep the version they started on.

    # Rehearse: writes the rewritten definitions and validates them against the
    # local schema only; server checks (Skill access, retired models) never run.
    MEDIFORCE_BASE_URL=https://staging.mediforce.ai MEDIFORCE_API_KEY=... \\
        python3 scripts/migrations/backfill_step_agent_versions.py \\
        --out-dir /tmp/agent-version-backfill --dry-run

    # Apply.
    MEDIFORCE_BASE_URL=https://staging.mediforce.ai MEDIFORCE_API_KEY=... \\
        python3 scripts/migrations/backfill_step_agent_versions.py \\
        --out-dir /tmp/agent-version-backfill

An API key acts as the system, so it covers every workspace; --namespace
(repeatable) narrows it. Re-runnable: a workflow whose steps are all pinned or
deliberately live is skipped, and a workflow that fails is reported without
stopping the others.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
# Assigned server-side, or lifecycle that belongs to the version it was set on:
# the rewrite is neither archived nor imported from the git commit `source` names.
NOT_REGISTERABLE_FIELDS = ("version", "createdAt", "namespace", "legacyDefinition", "source", "archived", "deleted")


class BackfillError(Exception):
    pass


def mediforce_json(*arguments: str) -> dict:
    result = subprocess.run(["pnpm", "--silent", "exec", "mediforce", *arguments, "--json"],
                            cwd=REPO_ROOT, capture_output=True, text=True)
    command = f"mediforce {' '.join(arguments[:2])}"
    try:
        output = json.loads(result.stdout)
    except ValueError:
        output = None
    if result.returncode != 0:
        if isinstance(output, dict) and "error" in output:
            message = output["error"]
        else:
            message = result.stdout.strip() or result.stderr.strip()
        raise BackfillError(f"{command}: {message}")
    if isinstance(output, dict) is False:
        raise BackfillError(f"{command}: unreadable output: {result.stdout.strip()[:200]}")
    return output


class AgentVersions:
    """Each Agent's current version, read once, or why it has none."""

    def __init__(self) -> None:
        self.cache: dict[str, tuple[int | None, str]] = {}

    def of(self, agent_id: str) -> tuple[int | None, str]:
        if agent_id not in self.cache:
            try:
                current = mediforce_json("agent", "versions", agent_id)["current"]
                reason = "changed since its newest recorded version; save it once, then re-run"
            except BackfillError as error:
                current, reason = None, str(error)
            self.cache[agent_id] = (current, reason)
        return self.cache[agent_id]


def is_unpinned(step: dict) -> bool:
    return step.get("agentId") is not None and "agentVersion" not in step


def has_unpinned(definition: dict) -> bool:
    return any(map(is_unpinned, definition["steps"]))


def changed_since_listed(namespace: str, name: str, listed_version: int, listed_default: int | None) -> str | None:
    """Why the workflow moved on since `workflow list`, or None when it has not."""
    current = mediforce_json("workflow", "list-versions", name, "--namespace", namespace)
    newer = [entry["version"] for entry in current["versions"]
             if entry["version"] > listed_version and entry.get("archived") is not True]
    if len(newer) > 0:
        return f"v{max(newer)} was saved since it was listed"
    if current["defaultVersion"] != listed_default:
        return f"its default moved to v{current['defaultVersion']} since it was listed"
    return None


def pin_steps(definition: dict, agents: AgentVersions) -> tuple[list[str], list[str]]:
    """Pin each unpinned step in place; returns what was pinned and what could not be."""
    pinned: list[str] = []
    unpinnable: list[str] = []
    for step in definition["steps"]:
        if is_unpinned(step) is False:
            continue
        agent_id = step["agentId"]
        version, reason = agents.of(agent_id)
        if version is None:
            unpinnable.append(f"{step['id']} ({agent_id}: {reason})")
            continue
        step["agentVersion"] = version
        pinned.append(f"{step['id']} -> {agent_id} v{version}")
    return pinned, unpinnable


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out-dir", required=True, help="Where rewritten definitions are written")
    parser.add_argument("--namespace", action="append", default=[], help="Limit to a workspace (repeatable; default: all)")
    parser.add_argument("--dry-run", action="store_true", help="Rewrite and validate locally only; register nothing")
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
        if latest is None:
            continue
        label = f"{namespace}/{name} v{latest['version']}"
        default_version = group["defaultVersion"]
        try:
            if default_version is not None and default_version != latest["version"]:
                default = mediforce_json("workflow", "get", name, "--namespace", namespace, "--version", str(default_version))
                if default.get("archived") is not True:
                    if has_unpinned(latest) is True:
                        failures.append(f"{label}: skipped, its default v{default_version} is older; pin the version that should run by hand")
                    elif has_unpinned(default) is True:
                        failures.append(f"{label}: its default v{default_version} still has unpinned steps; "
                                        f"set the default to a pinned version by hand")
                    continue
            if has_unpinned(latest) is False:
                continue

            definition = {key: value for key, value in latest.items() if key not in NOT_REGISTERABLE_FIELDS}
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
            if args.dry_run is True:
                mediforce_json("workflow", "register", "--file", str(target), "--namespace", namespace, "--dry-run")
                backfilled += 1
                continue

            moved_on = changed_since_listed(namespace, name, latest["version"], default_version)
            if moved_on is not None:
                failures.append(f"{label}: skipped, {moved_on}; re-run")
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
