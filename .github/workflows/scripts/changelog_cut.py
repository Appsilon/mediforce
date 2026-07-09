#!/usr/bin/env python3
"""Cut the `## [Unreleased]` section in CHANGELOG.md to a dated section.

Reads CHANGELOG.md, finds the `## [Unreleased]` block, renames it to
`## [YYYY-MM-DD]`, and inserts a fresh empty `## [Unreleased]` above it.

If the [Unreleased] block has no bullets (only subsection headers or empty),
exits 0 with `changed=false` so the workflow skips opening a PR.

Writes to GITHUB_OUTPUT when present, and writes the file in place.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

UNRELEASED_HEADER = "## [Unreleased]"
NEW_UNRELEASED_BLOCK = "## [Unreleased]\n\n"


def set_output(key: str, value: str) -> None:
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"{key}={value}\n")
    else:
        print(f"::set-output name={key}::{value}")


def cut(text: str, date: str) -> tuple[str, bool]:
    lines = text.splitlines(keepends=True)
    start = None
    for index, line in enumerate(lines):
        if line.rstrip() == UNRELEASED_HEADER:
            start = index
            break
    if start is None:
        print("ERROR: `## [Unreleased]` header not found", file=sys.stderr)
        sys.exit(1)

    end = len(lines)
    for index in range(start + 1, len(lines)):
        if re.match(r"^## \[", lines[index]):
            end = index
            break

    body = "".join(lines[start + 1 : end])
    has_bullet = any(line.lstrip().startswith("- ") for line in body.splitlines())
    if not has_bullet:
        return text, False

    new_header = f"## [{date}]\n"
    rebuilt = (
        "".join(lines[:start])
        + NEW_UNRELEASED_BLOCK
        + new_header
        + body
        + "".join(lines[end:])
    )
    return rebuilt, True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True, type=Path)
    parser.add_argument("--date", required=True, help="YYYY-MM-DD")
    args = parser.parse_args()

    original = args.file.read_text(encoding="utf-8")
    rebuilt, changed = cut(original, args.date)
    if changed:
        args.file.write_text(rebuilt, encoding="utf-8")
    set_output("changed", "true" if changed else "false")


if __name__ == "__main__":
    main()
