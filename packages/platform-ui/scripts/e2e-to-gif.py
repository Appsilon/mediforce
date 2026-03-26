#!/usr/bin/env python3
"""Convert E2E test recordings (webm) to GIFs in docs/features/.

Auto-detects and trims loading screens from the beginning.
"""

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

FEATURES_DIR = Path("../../docs/features")
RESULTS_DIR = Path("test-results")


def clean_name(dirname: str) -> str:
    """Extract clean GIF name from Playwright test result directory name.

    Takes the file prefix (before .journey.ts). If multiple tests share
    a prefix, they get numbered: task-review, task-review-2, task-review-3.
    """
    dirname = re.sub(r"-authenticated$", "", dirname)
    return dirname.split(".journey.ts-")[0]


# Track how many times each prefix appears to add numbers for duplicates
_name_counts: dict[str, int] = {}


def unique_name(dirname: str) -> str:
    """Get a unique GIF name, adding -2, -3 etc for duplicates."""
    base = clean_name(dirname)
    _name_counts[base] = _name_counts.get(base, 0) + 1
    count = _name_counts[base]
    return base if count == 1 else f"{base}-{count}"


def find_content_start(video: Path) -> float:
    """Find when loading ends by checking frame complexity (file size as proxy)."""
    with tempfile.TemporaryDirectory() as tmpdir:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(video), "-vf", "fps=2,scale=320:-1", f"{tmpdir}/f%04d.png"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        for i, frame in enumerate(sorted(Path(tmpdir).glob("f*.png"))):
            if frame.stat().st_size > 2000:
                return i * 0.5
    return 0


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

        name = unique_name(dirname)
        output = FEATURES_DIR / f"{name}.gif"
        trim = find_content_start(video)

        subprocess.run(
            [
                "ffmpeg", "-y",
                *(["-ss", str(trim)] if trim > 0 else []),
                "-i", str(video),
                "-vf",
                "fps=10,scale=960:-1:flags=lanczos,"
                "split[s0][s1];"
                "[s0]palettegen=max_colors=256:stats_mode=diff[p];"
                "[s1][p]paletteuse=dither=sierra2_4a",
                "-loop", "0",
                str(output),
            ],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True,
        )

        size = output.stat().st_size
        human_size = f"{size / 1_048_576:.1f}M" if size >= 1_048_576 else f"{size / 1024:.0f}K"
        trim_note = f", trimmed {trim:.1f}s" if trim > 0 else ""

        print(f"\u2713 {name}.gif ({human_size}{trim_note})")
        count += 1

    print(f"\nConverted {count} recordings to {FEATURES_DIR}/")
    if count > 0:
        print(f"Update {FEATURES_DIR}/FEATURES.md if new features were added.")


if __name__ == "__main__":
    main()
