#!/usr/bin/env python3
"""Check that journey test changes have matching GIF updates."""

import re
import subprocess
import sys


def main() -> None:
    base = sys.argv[1] if len(sys.argv) > 1 else "origin/main"

    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", f"{base}...HEAD"],
            capture_output=True, text=True, check=True,
        )
        changed = result.stdout
    except subprocess.CalledProcessError:
        result = subprocess.run(
            ["git", "diff", "--name-only", base, "HEAD"],
            capture_output=True, text=True, check=True,
        )
        changed = result.stdout

    lines = changed.strip().splitlines() if changed.strip() else []
    journeys_changed = sum(1 for line in lines if "e2e/journeys/" in line)
    gifs_changed = sum(1 for line in lines if re.search(r"docs/features/.*\.gif", line))

    if journeys_changed > 0 and gifs_changed == 0:
        print(f"\u274c Journey tests changed ({journeys_changed} files) but no GIFs updated in docs/features/.")
        print()
        print("Run: cd packages/platform-ui && pnpm test:e2e:gif")
        sys.exit(1)

    print(f"\u2713 Journey tests changed: {journeys_changed}, GIFs updated: {gifs_changed} \u2014 OK")


if __name__ == "__main__":
    main()
