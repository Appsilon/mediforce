#!/usr/bin/env python3
"""E2E build-freshness gate for `next start`.

`start:e2e` serves a prebuilt `.next` bundle for speed. Without a freshness
check it can serve a bundle that predates the current source — after a branch
switch, or after an *uncommitted* source edit — producing e2e passes/failures
that reflect stale code. This gate stamps a fingerprint of the source into the
built bundle and, before `next start`, rebuilds whenever the working tree no
longer matches that stamp.

The fingerprint hashes the *contents* of the same source set the CI `.next`
cache key is built from (see `.github/workflows/ci.yml`), so it moves with any
change that alters the bundle — committed or not, including new and deleted
files. HEAD is deliberately not part of it: an uncommitted edit leaves HEAD
unchanged yet must still force a rebuild.

On CI the `.next` cache is itself keyed on that same source hash, so a restored
bundle already matches the current source and is authoritative. There the gate
only checks that a build exists and never rebuilds, preserving the cache.

Usage:
    python3 scripts/e2e_build_gate.py stamp    # after `next build`
    python3 scripts/e2e_build_gate.py ensure   # before `next start`
"""

from __future__ import annotations

import hashlib
import os
import subprocess
import sys
from pathlib import Path

PLATFORM_UI = Path(__file__).resolve().parent.parent
ROOT = PLATFORM_UI.parent.parent

NEXT_DIR = PLATFORM_UI / ".next"
BUILD_ID = NEXT_DIR / "BUILD_ID"
STAMP = NEXT_DIR / "BUILD_SOURCE_HASH"

# Mirrors the `hashFiles(...)` set of the CI `.next` cache key in ci.yml. Keep in
# sync: anything baked into the bundle that CI keys the cache on belongs here.
SOURCE_GLOBS = [
    "packages/*/src/**/*.ts",
    "packages/*/src/**/*.tsx",
    "packages/*/src/**/*.js",
    "packages/*/src/**/*.jsx",
    "packages/*/src/**/*.css",
    "packages/platform-ui/public/**/*",
    "packages/platform-ui/next.config.mjs",
    "packages/*/tsconfig.json",
    "tsconfig.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
]


def on_ci() -> bool:
    return os.environ.get("CI", "").lower() in {"1", "true", "yes"}


def source_fingerprint() -> str:
    """Hash the contents of every source file the bundle is built from.

    Deterministic across runs: files are hashed in sorted path order, each
    prefixed by its repo-relative path so a rename registers as a change.
    """
    digest = hashlib.sha256()
    paths: set[Path] = set()
    for pattern in SOURCE_GLOBS:
        paths.update(ROOT.glob(pattern))
    for path in sorted(paths):
        if not path.is_file():
            continue
        digest.update(str(path.relative_to(ROOT)).encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def stamp() -> None:
    NEXT_DIR.mkdir(parents=True, exist_ok=True)
    STAMP.write_text(source_fingerprint() + "\n")


def rebuild() -> None:
    subprocess.run(["pnpm", "build:e2e"], cwd=str(PLATFORM_UI), check=True)


def ensure() -> None:
    if on_ci():
        # The cache key already encodes the source hash, so a restored bundle
        # matches the current source. Only rebuild if there is no build at all.
        if not BUILD_ID.exists():
            rebuild()
        return
    if STAMP.exists() and STAMP.read_text().strip() == source_fingerprint():
        return
    rebuild()


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[1] not in {"stamp", "ensure"}:
        print(f"usage: {argv[0]} stamp|ensure", file=sys.stderr)
        return 2
    if argv[1] == "stamp":
        stamp()
    else:
        ensure()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
