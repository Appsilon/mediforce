#!/usr/bin/env python3
"""
Catalogue the images already on the Docker daemon (ADR-0022).

The Image Catalog is a curated table, not a view over the daemon: an image
nobody registered is invisible to it, which is why a deployment with a full
`docker images` opens the Images tab on "No images catalogued yet". This
backfills it.

Two phases, because `intent` cannot be machine-written. ADR-0022 decision 2
makes intent the one field a human writes — the sentence that stays true across
rebuilds — and a script that fills it with "Imported from the daemon" produces
the catalog of meaningless rows the feature exists to replace. So phase 1 does
every mechanical part (discovery, grouping into sources, namespace routing) and
leaves `intent` blank; phase 2 refuses to register an entry whose intent is
still blank.

    # 1. Draft — reads the daemon, writes a file to fill in. Changes nothing.
    python3 scripts/migrations/adopt_daemon_images.py \
        --namespace acme --draft /tmp/images.json

    # 2. Fill in every "intent" (and adjust "name"), then register.
    python3 scripts/migrations/adopt_daemon_images.py --apply /tmp/images.json

Re-runnable: an entry whose source is already catalogued is reported as
skipped, not failed, so a partly-applied draft can be re-applied.

Images are grouped by *source*, not by artifact, which is what collapses five
`mediforce-agent:*` tags into one entry with five versions. A source is
`built` when the image carries `mediforce.build.*` labels (the platform built
it, and its versions are commits) and `referenced` otherwise (pulled or
hand-built, and its versions are tags).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

# Excluded by default because they are not images a step should be offered.
# An explicit list, not a heuristic: a reader can see exactly what was dropped
# and --include-all brings it all back.
EXCLUDED_PREFIXES = ("mediforce-test-", "mediforce-e2e-")
EXCLUDED_REPOSITORIES = frozenset({"postgres", "redis", "<none>"})

# Base images stay in by default. The picker already filters per executor —
# alpine is probed, found not agent-capable, and hidden from agent steps while
# staying available to a bash script step (ADR-0022 decision 5).


def run_cli(args: list[str], cli: str) -> tuple[int, str]:
    """Invoke the Mediforce CLI. Dogfooding is mandatory (AGENTS.md §4)."""
    result = subprocess.run(
        cli.split() + args,
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
        timeout=120,
    )
    return result.returncode, (result.stdout or "") + (result.stderr or "")


def fetch_daemon_images(cli: str) -> list[dict[str, Any]]:
    code, out = run_cli(["system", "images", "--json"], cli)
    if code != 0:
        raise SystemExit(f"`mediforce system images` failed:\n{out}")
    # The CLI prints the JSON object last; anything before it is log noise.
    start = out.find("{")
    if start < 0:
        raise SystemExit(f"No JSON in `mediforce system images` output:\n{out}")
    payload = json.loads(out[start:])
    return payload.get("images", [])


def assert_namespace_exists(namespace: str, cli: str) -> None:
    """Fail before writing a draft aimed at a workspace that does not exist.

    Without this the mistake surfaces only at --apply, after the intents have
    been written by hand — and a draft aimed at the wrong workspace applies
    cleanly, leaving the operator looking at a still-empty Images tab.
    """
    code, out = run_cli(["namespace", "get", "--handle", namespace], cli)
    if code != 0:
        raise SystemExit(
            f"Cannot read namespace \"{namespace}\":\n{out.strip()}\n\n"
            "Pass the handle whose Images tab you are opening."
        )


def is_excluded(repository: str) -> bool:
    return repository in EXCLUDED_REPOSITORIES or repository.startswith(EXCLUDED_PREFIXES)


def source_of(image: dict[str, Any]) -> dict[str, Any]:
    """The entry key this image belongs to (ADR-0022 decision 1).

    The repo string is passed through raw: `canonicalizeSource` normalises it
    server-side, and re-implementing `normalizeRepoUrls` here would be a second
    source of truth about what makes two repos the same.
    """
    build_repo = image.get("buildRepo")
    if build_repo:
        return {
            "kind": "built",
            "repo": build_repo,
            "dockerfile": image.get("buildDockerfile", ""),
        }
    return {"kind": "referenced", "reference": image["repository"]}


def group_key(source: dict[str, Any]) -> tuple[str, ...]:
    if source["kind"] == "built":
        return ("built", source["repo"], source["dockerfile"])
    return ("referenced", source["reference"])


def is_local_path_repo(repo: str) -> bool:
    """A build repo that is a filesystem path, not a remote.

    Nothing else can rebuild it and the path is usually already gone — it is
    build residue from a test run, not an image a workspace offers.
    """
    return repo.startswith((".", "/")) or repo.startswith("file://")


def suggested_name(source: dict[str, Any]) -> str:
    # A referenced source keeps its whole reference: `rocker/r-ver` is the
    # image's identity and dropping the org makes two orgs' images collide.
    # A built source is a git URL, where only the last segment reads.
    if source["kind"] == "referenced":
        return source["reference"]
    return source["repo"].rstrip("/").split("/")[-1].removesuffix(".git")


def build_draft(
    images: list[dict[str, Any]], namespace: str, include_all: bool
) -> tuple[list[dict[str, Any]], list[str]]:
    grouped: dict[tuple[str, ...], dict[str, Any]] = {}
    dropped: list[str] = []

    for image in images:
        repository = image.get("repository", "")
        if not include_all and is_excluded(repository):
            dropped.append(f"{repository}:{image.get('tag', '')}")
            continue

        source = source_of(image)
        if not include_all and source["kind"] == "built" and is_local_path_repo(source["repo"]):
            dropped.append(f"{repository}:{image.get('tag', '')}  (built from a local path)")
            continue

        key = group_key(source)
        entry = grouped.setdefault(
            key,
            {
                # The build label wins over --namespace: the platform already
                # recorded which namespace owns that image.
                "namespace": image.get("buildNamespace") or namespace,
                "name": suggested_name(source),
                "intent": "",
                "source": source,
                "_versions": [],
            },
        )
        entry["_versions"].append(f"{repository}:{image.get('tag', '')}")

    return list(grouped.values()), dropped


def cmd_draft(args: argparse.Namespace) -> int:
    assert_namespace_exists(args.namespace, args.cli)
    images = fetch_daemon_images(args.cli)
    entries, dropped = build_draft(images, args.namespace, args.include_all)

    print(f"{len(images)} image(s) on the daemon -> {len(entries)} catalog entr(ies).\n")
    for entry in sorted(entries, key=lambda e: e["name"]):
        versions = entry["_versions"]
        print(f"  {entry['name']}  [{entry['source']['kind']}]  ns={entry['namespace']}")
        print(f"    {len(versions)} version(s): {', '.join(sorted(versions))}")
    if dropped:
        print(f"\nExcluded {len(dropped)} image(s) (--include-all keeps them):")
        for name in sorted(dropped):
            print(f"  {name}")

    draft = {"entries": sorted(entries, key=lambda e: e["name"])}
    Path(args.draft).write_text(json.dumps(draft, indent=2) + "\n", encoding="utf-8")
    print(f"\nDraft written to {args.draft}")
    print("Fill in every \"intent\" (one sentence: what the image is FOR), then:")
    print(f"  python3 {Path(__file__).relative_to(REPO_ROOT)} --apply {args.draft}")
    return 0


def create_args(entry: dict[str, Any]) -> list[str]:
    source = entry["source"]
    args = [
        "images", "create",
        "--namespace", entry["namespace"],
        "--name", entry["name"],
        "--intent", entry["intent"],
    ]
    if source["kind"] == "built":
        args += ["--repo", source["repo"]]
        if source["dockerfile"]:
            args += ["--dockerfile", source["dockerfile"]]
    else:
        args += ["--reference", source["reference"]]
    return args


def cmd_apply(args: argparse.Namespace) -> int:
    draft = json.loads(Path(args.apply).read_text(encoding="utf-8"))
    entries = draft.get("entries", [])

    blank = [entry["name"] for entry in entries if not entry.get("intent", "").strip()]
    if blank:
        print(f"{len(blank)} entr(ies) still have a blank intent and will be skipped:")
        for name in blank:
            print(f"  {name}")
        print()

    created, skipped, failed = 0, 0, 0
    for entry in entries:
        if not entry.get("intent", "").strip():
            skipped += 1
            continue
        code, out = run_cli(create_args(entry), args.cli)
        if code == 0:
            created += 1
            print(f"  catalogued  {entry['name']}")
        elif "already describes this source" in out:
            skipped += 1
            print(f"  exists      {entry['name']}")
        else:
            failed += 1
            reason = out.strip().splitlines()[-1] if out.strip() else f"exit {code}"
            print(f"  FAILED      {entry['name']}: {reason}")

    print(f"\n{created} created, {skipped} skipped, {failed} failed.")
    return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    parser.add_argument("--namespace", help="Namespace for images with no build label")
    parser.add_argument("--draft", help="Path to write the draft file to")
    parser.add_argument("--apply", help="Path to a filled-in draft file to register")
    parser.add_argument(
        "--include-all",
        action="store_true",
        help="Keep test artifacts and dev-infra images the default drops",
    )
    parser.add_argument(
        "--cli",
        default="pnpm exec mediforce",
        help="How to invoke the CLI (default: pnpm exec mediforce)",
    )
    args = parser.parse_args()

    if args.apply:
        return cmd_apply(args)
    if not args.namespace or not args.draft:
        parser.error("--namespace and --draft are required to build a draft")
    return cmd_draft(args)


if __name__ == "__main__":
    sys.exit(main())
