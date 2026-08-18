#!/usr/bin/env python3
"""Fail the build when a package or app has no README.md.

`docs/README.md` ("Where new docs go") makes a package or app the authority on
itself: what it is for, what depends on it, what you must not do to it. That
convention only holds if a new directory cannot ship without one — a norm alone
is what let the retired knowledge base drift (ADR-0017).

Runs in `ci.yml` rather than `docs.yml` on purpose: a new package containing no
Markdown file at all does not match the `**.md` path filter, which is exactly
the case this check exists to catch.
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Direct children of these are the units that document themselves.
PARENTS = ("packages", "apps")

SKIP_NAMES = {"node_modules", "dist", "build", ".turbo", "coverage"}


def directories_needing_readme() -> list[Path]:
    found = []
    for parent in PARENTS:
        parent_dir = REPO_ROOT / parent
        if not parent_dir.is_dir():
            continue
        for child in sorted(parent_dir.iterdir()):
            if not child.is_dir():
                continue
            if child.name.startswith(".") or child.name in SKIP_NAMES:
                continue
            found.append(child)
    return found


def main() -> int:
    checked = directories_needing_readme()
    missing = [d for d in checked if not (d / "README.md").is_file()]

    if missing:
        print("Missing README.md:\n", file=sys.stderr)
        for directory in missing:
            print(f"  {directory.relative_to(REPO_ROOT)}/README.md", file=sys.stderr)
        print(
            "\nEvery package and app documents itself in its own README.md.\n"
            "Keep it short and aimed at what the code does not say: what the\n"
            "package is for, what depends on it, what you must not do to it.\n"
            "See docs/README.md -> Conventions -> Where new docs go.",
            file=sys.stderr,
        )
        return 1

    print(f"README coverage OK. {len(checked)} packages and apps checked.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
