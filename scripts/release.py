#!/usr/bin/env python3
"""Cut and publish Mediforce releases. Run by `.github/workflows/release.yml`.

  release.py prepare --bump auto|patch|minor|major
      Pick the next version from the PR titles merged since the last release,
      bump the root package.json, and open that version's CHANGELOG section as
      a draft listing those PRs. Prints the version.

  release.py notes <version>
      Print the version's CHANGELOG section. Fails while the section is missing,
      empty, or still holds the draft comment, so unwritten notes never ship.

The bump follows the PR titles' conventional-commit prefix: any `type!:` is
major, any `feat` is minor, anything else is patch.
"""

import argparse
import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CHANGELOG = REPO_ROOT / "CHANGELOG.md"
PACKAGE_JSON = REPO_ROOT / "package.json"

SEMVER_TAG = re.compile(r"^v(\d+)\.(\d+)\.(\d+)$")
CONVENTIONAL_TITLE = re.compile(r"^(?P<type>\w+)(\([^)]*\))?(?P<breaking>!)?:")
DRAFT_MARKER = "<!-- release-draft"
UNRELEASED_HEADING = "## [Unreleased]"
BUMPS = ("patch", "minor", "major")


def run(*command: str) -> str:
    return subprocess.run(command, cwd=REPO_ROOT, check=True, capture_output=True, text=True).stdout


def latest_release_tag() -> tuple[str, tuple[int, int, int]]:
    versions = []
    for tag in run("git", "tag", "--list", "v*").split():
        match = SEMVER_TAG.match(tag)
        if match is not None:
            versions.append((tuple(int(part) for part in match.groups()), tag))
    if len(versions) == 0:
        sys.exit("No vX.Y.Z tag found. Fetch tags first (actions/checkout with fetch-depth: 0).")
    version, tag = max(versions)
    return tag, version


def merged_pull_requests_since(tag: str) -> list[dict]:
    since = run("git", "log", "-1", "--format=%cI", tag).strip()
    output = run(
        "gh", "pr", "list", "--state", "merged", "--base", "main",
        "--search", f"merged:>{since}", "--limit", "500", "--json", "number,title,headRefName",
    )
    shipped = [pr for pr in json.loads(output) if not pr["headRefName"].startswith("release/")]
    return sorted(shipped, key=lambda pull_request: pull_request["number"])


def bump_for(titles: list[str]) -> str:
    bump = "patch"
    for title in titles:
        match = CONVENTIONAL_TITLE.match(title)
        if match is None:
            continue
        if match.group("breaking") is not None:
            return "major"
        if match.group("type") == "feat":
            bump = "minor"
    return bump


def next_version(current: tuple[int, int, int], bump: str) -> str:
    major, minor, patch = current
    if bump == "major":
        return f"{major + 1}.0.0"
    if bump == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def set_package_version(version: str) -> None:
    text = PACKAGE_JSON.read_text()
    updated, count = re.subn(r'("version":\s*")[^"]*(")', rf"\g<1>{version}\g<2>", text, count=1)
    if count != 1:
        sys.exit("package.json has no version field.")
    PACKAGE_JSON.write_text(updated)


def open_changelog_section(version: str, pull_requests: list[dict]) -> None:
    text = CHANGELOG.read_text()
    if f"## [{version}]" in text:
        sys.exit(f"CHANGELOG.md already has a [{version}] section.")
    if UNRELEASED_HEADING not in text:
        sys.exit(f"CHANGELOG.md has no '{UNRELEASED_HEADING}' heading.")

    head, rest = text.split(UNRELEASED_HEADING, 1)
    next_section = rest.find("\n## [")
    unreleased = rest if next_section == -1 else rest[:next_section]
    remainder = "" if next_section == -1 else rest[next_section:]

    pull_request_lines = "\n".join(f"#{pr['number']} {pr['title']}" for pr in pull_requests)
    draft = (
        f"{DRAFT_MARKER}\n"
        "Write this release for the people who use and run Mediforce, following\n"
        "skills/add-changelog-entry/SKILL.md, then delete this comment.\n"
        "The release refuses to publish while it is here.\n\n"
        f"Merged since the last release:\n{pull_request_lines}\n-->"
    )
    folded = unreleased.strip()
    body = draft if folded == "" else f"{draft}\n\n{folded}"
    section = f"## [{version}] - {date.today().isoformat()}\n\n{body}\n"

    CHANGELOG.write_text(f"{head}{UNRELEASED_HEADING}\n\n{section}{remainder}")


def prepare(bump: str) -> int:
    tag, current = latest_release_tag()
    pull_requests = merged_pull_requests_since(tag)
    if len(pull_requests) == 0:
        sys.exit(f"Nothing merged since {tag}; there is nothing to release.")

    chosen = bump_for([pr["title"] for pr in pull_requests]) if bump == "auto" else bump
    version = next_version(current, chosen)
    if run("git", "tag", "--list", f"v{version}").strip() != "":
        sys.exit(f"Tag v{version} already exists.")

    set_package_version(version)
    open_changelog_section(version, pull_requests)
    print(version)
    return 0


def notes(version: str) -> int:
    text = CHANGELOG.read_text()
    match = re.search(rf"^## \[{re.escape(version)}\][^\n]*\n(.*?)(?=^## \[|\Z)", text, re.MULTILINE | re.DOTALL)
    if match is None:
        sys.exit(f"CHANGELOG.md has no '## [{version}]' section.")
    section = match.group(1).strip()
    if DRAFT_MARKER in section:
        sys.exit(f"The [{version}] section is still a draft. Write it and delete the release-draft comment.")
    if section == "":
        sys.exit(f"The [{version}] section is empty.")
    print(section)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare_parser = commands.add_parser("prepare")
    prepare_parser.add_argument("--bump", choices=("auto", *BUMPS), default="auto")
    notes_parser = commands.add_parser("notes")
    notes_parser.add_argument("version")
    arguments = parser.parse_args()

    if arguments.command == "prepare":
        return prepare(arguments.bump)
    return notes(arguments.version)


if __name__ == "__main__":
    sys.exit(main())
