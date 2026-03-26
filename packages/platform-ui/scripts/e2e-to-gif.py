#!/usr/bin/env python3
"""Convert E2E test recordings (webm) to GIFs in docs/features/.

Auto-detects and trims loading screens from the beginning.
Verifies each GIF has real content before saving.
"""

import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

FEATURES_DIR = Path("../../docs/features")
RESULTS_DIR = Path("test-results")


# Load name mapping: test file → { test description substring → gif name }
_GIF_NAMES_PATH = Path(__file__).parent.parent / "e2e" / "helpers" / "gif-names.json"
_GIF_NAMES: dict[str, dict[str, str]] = {}
if _GIF_NAMES_PATH.exists():
    _GIF_NAMES = json.loads(_GIF_NAMES_PATH.read_text())


def clean_name(dirname: str) -> str:
    """Map Playwright result dir to a clean GIF name using gif-names.json.

    Falls back to file-prefix-N if no mapping found.
    """
    dirname = re.sub(r"-authenticated$", "", dirname)
    parts = dirname.split(".journey.ts-", 1)
    filename = parts[0] + ".journey.ts"
    slug = parts[1] if len(parts) > 1 else ""

    # Try to match against gif-names.json
    file_map = _GIF_NAMES.get(filename, {})
    for substring, gif_name in file_map.items():
        if substring.lower().replace(" ", "-") in slug.lower().replace(" ", "-"):
            return gif_name

    # Fallback
    return parts[0]


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
        # Check frame at 1s (not 3s — some GIFs are short)
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
        dirname = video.parent.name
        if filter_arg and filter_arg not in dirname:
            continue

        name = clean_name(dirname)
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
            print(f"\u2717 {name}.gif — FAILED VERIFICATION (login/loading screen?)")
            output.unlink()
            bad_count += 1

    print(f"\nConverted: {ok_count} OK, {bad_count} failed")
    if bad_count > 0:
        print("Some GIFs failed verification — re-record with: pnpm test:e2e:record")
        sys.exit(1)
    if ok_count > 0:
        print(f"Update {FEATURES_DIR}/FEATURES.md if new features were added.")


if __name__ == "__main__":
    main()
