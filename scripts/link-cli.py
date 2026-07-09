#!/usr/bin/env python3
"""Symlink the workspace CLI entrypoint into the user's global bin directory.

After running, `mediforce` resolves to `packages/cli/bin/mediforce.cjs`
via tsx, so every code change is picked up immediately — no rebuild needed.

Usage: pnpm link:cli
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CLI_BIN = REPO_ROOT / "packages" / "cli" / "bin" / "mediforce.cjs"


def find_global_bin() -> Path | None:
    pnpm_home = os.environ.get("PNPM_HOME")
    if pnpm_home:
        return Path(pnpm_home)

    try:
        result = subprocess.run(
            ["pnpm", "root", "-g"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            return Path(result.stdout.strip()).parent / "bin"
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    # Check existing install location, but skip workspace-local node_modules
    existing = shutil.which("mediforce")
    if existing:
        parent = Path(existing).resolve().parent
        if "node_modules" not in parent.parts:
            return parent

    fallbacks = [
        Path.home() / ".local" / "bin",           # Linux (XDG)
        Path.home() / "Library" / "pnpm",          # macOS pnpm default
        Path("/usr/local/bin"),                     # macOS/Linux system
    ]
    for candidate in fallbacks:
        if candidate.exists() and os.access(candidate, os.W_OK):
            return candidate

    return None


def main() -> int:
    if not CLI_BIN.exists():
        print(f"[link-cli] ERROR: {CLI_BIN} not found", file=sys.stderr)
        return 1

    target_dir = find_global_bin()
    if target_dir is None:
        print("[link-cli] ERROR: could not find a writable global bin directory", file=sys.stderr)
        print("  Set PNPM_HOME or ensure ~/.local/bin exists", file=sys.stderr)
        return 1

    link_path = target_dir / "mediforce"
    link_path.unlink(missing_ok=True)
    link_path.symlink_to(CLI_BIN)
    print(f"[link-cli] {link_path} → {CLI_BIN}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
