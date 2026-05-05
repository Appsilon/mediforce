#!/usr/bin/env python3
"""Record E2E journey tests and convert to GIFs.

Forwards any extra arguments (e.g. --grep "Model Registry") to both
playwright test AND e2e-to-gif.py so you can record a single journey.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
from pathlib import Path

PLATFORM_UI = Path(__file__).resolve().parent.parent


def kill_port_9007() -> None:
    """Kill any process holding port 9007."""
    subprocess.run(
        ["lsof", "-ti:9007"],
        capture_output=True,
        text=True,
    )
    result = subprocess.run(["lsof", "-ti:9007"], capture_output=True, text=True)
    for pid in result.stdout.strip().splitlines():
        try:
            os.kill(int(pid), signal.SIGKILL)
        except (ValueError, ProcessLookupError):
            pass


def extract_grep_filter(args: list[str]) -> str:
    """Pull --grep value from args for e2e-to-gif.py filter."""
    for i, arg in enumerate(args):
        if arg == "--grep" and i + 1 < len(args):
            return args[i + 1]
        if arg.startswith("--grep="):
            return arg.split("=", 1)[1]
    return ""


def main() -> None:
    extra_args = sys.argv[1:]

    kill_port_9007()

    env = {**os.environ, "NEXT_PUBLIC_USE_EMULATORS": "true", "E2E_RECORD": "true"}

    playwright_cmd = [
        "npx", "playwright", "test",
        "--project=authenticated",
        "--workers=1",
        *extra_args,
    ]

    print(f"[record-gif] Running: {' '.join(playwright_cmd)}")
    result = subprocess.run(playwright_cmd, cwd=PLATFORM_UI, env=env)

    if result.returncode != 0:
        print(f"[record-gif] Playwright exited with code {result.returncode}")
        sys.exit(result.returncode)

    gif_filter = extract_grep_filter(extra_args)
    gif_cmd = ["python3", "scripts/e2e-to-gif.py"]
    if gif_filter:
        gif_cmd.append(gif_filter)

    print(f"[record-gif] Converting to GIFs: {' '.join(gif_cmd)}")
    result = subprocess.run(gif_cmd, cwd=PLATFORM_UI, env=env)
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
