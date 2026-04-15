#!/usr/bin/env python3
"""Bootstrap development environment for new developers.

Thin wrapper around bootstrap-e2e.py that skips Playwright/ffmpeg installation.

Usage:
    python3 packages/platform-ui/scripts/bootstrap-dev.py

Then:
    pnpm seed:dev
    NEXT_PUBLIC_USE_EMULATORS=true pnpm dev:ui
"""

from __future__ import annotations

import sys
from pathlib import Path

# Import shared bootstrap logic from E2E script
sys.path.insert(0, str(Path(__file__).resolve().parent))
from bootstrap_e2e import ensure_env_local, ensure_firebase_config, start_emulators, log


def main() -> None:
    log("Bootstrapping development environment...")

    created_env = ensure_env_local()
    ensure_firebase_config()
    start_emulators()

    log("Development environment ready!")
    print()
    if created_env:
        print("Next steps:")
        print("  1. Seed demo data:")
        print("     cd packages/platform-ui && pnpm seed:dev")
        print()
        print("  2. Start the app:")
        print("     NEXT_PUBLIC_USE_EMULATORS=true pnpm dev:ui")
        print()
        print("  3. Sign in with demo credentials:")
        print("     Email: test@mediforce.dev")
        print("     Password: test123456")
    else:
        print("Demo credentials:")
        print("  Email: test@mediforce.dev")
        print("  Password: test123456")
        print()
        print("Start the app:")
        print("  NEXT_PUBLIC_USE_EMULATORS=true pnpm dev:ui")


if __name__ == "__main__":
    main()
