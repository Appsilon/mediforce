#!/usr/bin/env python3
"""Build the mediforce-agent:protocol-to-synthetic-sdtm image.

The pipeline source lives in a sibling repo (ct_to_synthetic_data), and its
.venv directories total ~660M while the required offline CORE cache is ~462M.
To keep the Docker build context lean, this stages only the needed files into
a temp dir (dropping every .venv) and builds from there.

Source repo: $P2S_SRC, or ../ct_to_synthetic_data relative to the mediforce repo.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

IMAGE = "mediforce-agent:protocol-to-synthetic-sdtm"
CONTAINER_DIR = Path(__file__).resolve().parent
REPO_ROOT = CONTAINER_DIR.parents[2]


def resolve_source() -> Path:
    override = os.environ.get("P2S_SRC")
    src = Path(override) if override else REPO_ROOT.parent / "ct_to_synthetic_data"
    src = src.resolve()
    for required in ("test", "mcp/ctgov", "mcp/cdisclib", "cdisc-rules-engine"):
        if not (src / required).exists():
            sys.exit(f"Source repo missing {required} at {src}. Set P2S_SRC to the ct_to_synthetic_data checkout.")
    return src


def stage(src: Path, staging: Path) -> None:
    ignore_venv = shutil.ignore_patterns(".venv", "__pycache__", "*.pyc")
    shutil.copytree(src / "test", staging / "test", ignore=ignore_venv)
    shutil.copytree(src / "cdisc-rules-engine", staging / "cdisc-rules-engine", ignore=ignore_venv)
    for server in ("ctgov", "cdisclib"):
        dest = staging / "mcp" / server
        shutil.copytree(src / "mcp" / server / "src", dest / "src", ignore=ignore_venv)
        for meta in ("pyproject.toml", "README.md"):
            shutil.copy2(src / "mcp" / server / meta, dest / meta)
    shutil.copy2(CONTAINER_DIR / "Dockerfile", staging / "Dockerfile")


def main() -> None:
    src = resolve_source()
    with tempfile.TemporaryDirectory(prefix="p2s-build-") as tmp:
        staging = Path(tmp)
        print(f"Staging lean build context from {src} ...")
        stage(src, staging)
        print(f"Building {IMAGE} ...")
        subprocess.run(["docker", "build", "-t", IMAGE, str(staging)], check=True)
    print(f"Done. {IMAGE} is now available locally.")


if __name__ == "__main__":
    main()
