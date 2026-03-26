#!/usr/bin/env python3
"""Convert E2E test recordings (webm) to GIFs in docs/features/."""

import re
import shutil
import subprocess
import sys
from pathlib import Path

FEATURES_DIR = Path("../../docs/features")
RESULTS_DIR = Path("test-results")


def clean_name(dirname: str) -> str:
    """Extract clean GIF name from Playwright test result directory name.

    Input:  "task-review.journey.ts-Tas-9acde-uping-and-view-task-details-authenticated"
    Output: "task-review-uping-and-view-task-details"
    """
    dirname = re.sub(r"-authenticated$", "", dirname)
    file_prefix = re.sub(r"\.journey\.ts-.*", "", dirname)
    description = re.sub(r"^[^-]+-[^-]+-[a-f0-9]+-", "", dirname)
    combined = f"{file_prefix}-{description}"
    combined = re.sub(r"-+", "-", combined)
    combined = combined.strip("-")
    return combined


def main() -> None:
    if not shutil.which("ffmpeg"):
        print("Error: ffmpeg not found. Install with: brew install ffmpeg")
        sys.exit(1)

    if not RESULTS_DIR.is_dir():
        print("Error: No test-results/ directory. Run pnpm test:e2e:record first.")
        sys.exit(1)

    FEATURES_DIR.mkdir(parents=True, exist_ok=True)

    filter_arg = sys.argv[1] if len(sys.argv) > 1 else ""
    count = 0

    for video in sorted(RESULTS_DIR.glob("*/video.webm")):
        dirname = video.parent.name

        if filter_arg and filter_arg not in dirname:
            continue

        name = clean_name(dirname)
        output = FEATURES_DIR / f"{name}.gif"

        subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(video),
                "-vf",
                "fps=10,scale=960:-1:flags=lanczos,"
                "split[s0][s1];"
                "[s0]palettegen=max_colors=256:stats_mode=diff[p];"
                "[s1][p]paletteuse=dither=sierra2_4a",
                "-loop", "0",
                str(output),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
        )

        size = output.stat().st_size
        if size >= 1_048_576:
            human_size = f"{size / 1_048_576:.1f}M"
        else:
            human_size = f"{size / 1024:.0f}K"

        print(f"\u2713 {name}.gif ({human_size})")
        count += 1

    print()
    print(f"Converted {count} recordings to {FEATURES_DIR}/")
    if count > 0:
        print(f"Update {FEATURES_DIR}/FEATURES.md if new features were added.")


if __name__ == "__main__":
    main()
