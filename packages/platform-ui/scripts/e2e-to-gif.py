#!/usr/bin/env python3
"""Convert E2E test recordings (webm) to GIFs in docs/features/.

Reads gif-name.txt from each test result dir (written by setupRecording).
Auto-trims loading screens. Verifies each GIF has real content.
"""

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

FEATURES_DIR = Path("../../docs/features")
RESULTS_DIR = Path("test-results")


def find_content_start(video: Path) -> float:
    """Find when loading ends by checking frame complexity (PNG file size)."""
    with tempfile.TemporaryDirectory() as tmpdir:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(video), "-vf", "fps=2,scale=320:-1",
             f"{tmpdir}/f%04d.png"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        for i, frame in enumerate(sorted(Path(tmpdir).glob("f*.png"))):
            if frame.stat().st_size > 2000:
                return i * 0.5
    return 0


def verify_gif(gif_path: Path) -> bool:
    """Check GIF has real content (not just login/loading screen)."""
    with tempfile.NamedTemporaryFile(suffix=".png") as tmp:
        subprocess.run(
            ["ffmpeg", "-y", "-ss", "1", "-i", str(gif_path),
             "-vframes", "1", tmp.name],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        return Path(tmp.name).stat().st_size > 5000


def main() -> None:
    if not shutil.which("ffmpeg"):
        print("Error: ffmpeg not found. Install with: brew install ffmpeg")
        sys.exit(1)

    if not RESULTS_DIR.is_dir():
        print("Error: No test-results/ directory. Run pnpm test:e2e:record first.")
        sys.exit(1)

    FEATURES_DIR.mkdir(parents=True, exist_ok=True)

    filter_arg = sys.argv[1] if len(sys.argv) > 1 else ""
    ok_count = 0
    bad_count = 0

    for video in sorted(RESULTS_DIR.glob("*/video.webm")):
        result_dir = video.parent

        if filter_arg and filter_arg not in result_dir.name:
            continue

        # Read GIF name from file written by setupRecording()
        name_file = result_dir / "gif-name.txt"
        if not name_file.exists():
            print(f"⚠ Skipping {result_dir.name} — no gif-name.txt")
            continue

        name = name_file.read_text().strip()
        output = FEATURES_DIR / f"{name}.gif"

        trim = find_content_start(video)

        subprocess.run(
            [
                "ffmpeg", "-y",
                *(["-ss", str(trim)] if trim > 0 else []),
                "-i", str(video),
                "-vf",
                "fps=15,scale=960:-1:flags=lanczos,"
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

        if verify_gif(output):
            print(f"\u2713 {name}.gif ({human_size}{trim_note})")
            ok_count += 1
        else:
            print(f"\u2717 {name}.gif — FAILED VERIFICATION (login/loading?)")
            output.unlink()
            bad_count += 1

    print(f"\nConverted: {ok_count} OK, {bad_count} failed")
    if bad_count > 0:
        print("Re-record failed GIFs with: pnpm test:e2e:record")
        sys.exit(1)


if __name__ == "__main__":
    main()
