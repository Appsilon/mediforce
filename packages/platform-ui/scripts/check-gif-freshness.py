#!/usr/bin/env python3
"""Check that journey test changes have matching GIF updates.

Compares commit order: if journey tests were modified after the last GIF update,
GIFs are stale and need re-recording.
"""

from __future__ import annotations

import re
import subprocess
import sys


def last_commit_touching(base: str, pattern: str, *, exclude: str | None = None) -> int | None:
    """Return the index (0 = oldest) of the last commit in base..HEAD that touches pattern.

    Files matching `exclude` (if set) are not counted.
    """
    result = subprocess.run(
        ["git", "log", "--oneline", f"{base}..HEAD"],
        capture_output=True, text=True, check=True,
    )
    commits = result.stdout.strip().splitlines()
    if not commits:
        return None

    # commits[0] = newest, commits[-1] = oldest — reverse so index grows with time
    commits.reverse()
    last = None
    for idx, line in enumerate(commits):
        sha = line.split()[0]
        diff = subprocess.run(
            ["git", "diff", "--name-only", f"{sha}~1", sha],
            capture_output=True, text=True,
        )
        if diff.returncode != 0:
            continue
        matched = [f for f in diff.stdout.strip().splitlines() if re.search(pattern, f)]
        if exclude is not None:
            matched = [f for f in matched if not re.search(exclude, f)]
        if matched:
            last = idx
    return last


def main() -> None:
    base = sys.argv[1] if len(sys.argv) > 1 else "origin/main"

    # UI journey tests require GIF recordings. Browserless journeys (API-only,
    # Docker-backed workflow execution, etc.) don't produce recordable artefacts,
    # so exclude them. Convention: browserless tests use Playwright's `request`
    # fixture, not `page`, and their filenames opt out via suffix.
    last_journey = last_commit_touching(
        base,
        r"e2e/journeys/",
        exclude=r"(?:-api|-docker)\.journey\.ts$",
    )
    last_gif = last_commit_touching(base, r"docs/features/.*\.gif")

    if last_journey is None:
        print("\u2713 No journey test changes — OK")
        return

    if last_gif is None:
        print(f"\u274c Journey tests changed but no GIFs updated in docs/features/.")
        print()
        print("Run: cd packages/platform-ui && pnpm test:e2e:gif")
        sys.exit(1)

    if last_journey > last_gif:
        print(f"\u274c GIFs are stale — journey tests were modified after the last GIF update.")
        print()
        print("Run: cd packages/platform-ui && pnpm test:e2e:gif")
        sys.exit(1)

    print(f"\u2713 GIFs up to date (last journey change: commit {last_journey}, last GIF update: commit {last_gif}) — OK")


if __name__ == "__main__":
    main()
