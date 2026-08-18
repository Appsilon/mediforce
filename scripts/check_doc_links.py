#!/usr/bin/env python3
"""Fail the build when a Markdown file points at a file that does not exist.

Two classes of reference are checked:

1. Markdown links and images — `[text](target)` / `![alt](target)` — with a
   relative target, resolved against the linking file's directory.
2. Backticked repo paths ending in `.md` under `docs/` or `skills/`, resolved
   against the repo root. Skills reference docs this way rather than as links,
   and those references rot exactly like links do.

External URLs, `mailto:`, pure `#anchor` targets, fenced code blocks, and
placeholder paths (`<name>`, globs) are out of scope; anchors and query strings
are stripped before the existence check.

A document declaring `status: historical` (or, for an ADR, `status: superseded`)
in its frontmatter is skipped entirely: it records a past state of the repo, so
its references are expected to point at files that have since been deleted.
`CHANGELOG.md` is skipped for the same reason.
"""

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

SKIP_DIRS = {".git", "node_modules", ".next", "dist", "build", ".turbo", "coverage"}

# Records of a past repo state — their references are meant to be frozen, not live.
SKIP_FILES = {"CHANGELOG.md"}

FENCE_RE = re.compile(r"^\s*(```|~~~)")
FRONTMATTER_STATUS_RE = re.compile(r"^status:\s*(\S+)\s*$", re.MULTILINE)

LINK_RE = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
BACKTICK_PATH_RE = re.compile(r"`((?:docs|skills)/[^`\s]+\.md)`")

ROOT_ANCHORED_PREFIXES = ("docs/", "skills/")

# Artifacts a skill writes rather than reads — absent from a clean checkout.
GENERATED_PATHS = {"docs/pitch/deck.md"}


def markdown_files() -> list[Path]:
    files = []
    for path in REPO_ROOT.rglob("*.md"):
        if any(part in SKIP_DIRS for part in path.relative_to(REPO_ROOT).parts):
            continue
        files.append(path)
    return sorted(files)


def is_external(target: str) -> bool:
    return "://" in target or target.startswith(("mailto:", "tel:", "#"))


def is_placeholder(target: str) -> bool:
    """`<name>`, `docs/*.md`, `${VAR}` — patterns, not paths."""
    if any(ch in target for ch in "<>*${}"):
        return True
    return "/" not in target and "." not in target


def is_historical(text: str) -> bool:
    if not text.startswith("---"):
        return False
    end = text.find("\n---", 3)
    if end == -1:
        return False
    match = FRONTMATTER_STATUS_RE.search(text[3:end])
    return match is not None and match.group(1) in {"historical", "superseded"}


def strip_fragment(target: str) -> str:
    return target.split("#", 1)[0].split("?", 1)[0]


def check_file(path: Path) -> list[str]:
    problems = []
    text = path.read_text(encoding="utf-8")
    rel = path.relative_to(REPO_ROOT)
    if rel.as_posix() in SKIP_FILES or is_historical(text):
        return []

    in_fence = False
    for line_no, line in enumerate(text.splitlines(), start=1):
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue

        for target in LINK_RE.findall(line):
            if is_external(target) or is_placeholder(target):
                continue
            cleaned = strip_fragment(target)
            if cleaned == "":
                continue
            base = REPO_ROOT if cleaned.startswith("/") else path.parent
            resolved = (base / cleaned.lstrip("/")).resolve()
            if not resolved.exists():
                problems.append(f"{rel}:{line_no}: broken link -> {target}")

        for target in BACKTICK_PATH_RE.findall(line):
            if not target.startswith(ROOT_ANCHORED_PREFIXES) or is_placeholder(target):
                continue
            if target in GENERATED_PATHS:
                continue
            if not (REPO_ROOT / strip_fragment(target)).exists():
                problems.append(f"{rel}:{line_no}: dead path -> {target}")

    return problems


def main() -> int:
    problems = []
    files = markdown_files()
    for path in files:
        problems.extend(check_file(path))

    if problems:
        print(f"Broken documentation references ({len(problems)}):\n")
        for problem in problems:
            print(f"  {problem}")
        print(f"\nScanned {len(files)} Markdown files.")
        return 1

    print(f"All documentation references resolve. Scanned {len(files)} Markdown files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
