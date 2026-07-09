"""Fetch the CDISC Pilot 3 SDTM baseline into ./clean/.

Downloads the SDTM tabulation files used by the landing-zone v0.1 demo from the
public RConsortium repository:

    https://github.com/RConsortium/submissions-pilot3-adam-to-fda

Pilot 3 is the Xanomeline TTS Alzheimer's study (CDISCPILOT01, n=306). Only the
SDTM tabulations are pulled — ADaM is out of scope for v0.1.

Output:
    ./clean/
        DM.xpt  AE.xpt  LB.xpt  EX.xpt  VS.xpt  define.xml

Run from anywhere; output is written next to this script. Idempotent — files
already present are skipped unless ``--force`` is given.
"""

from __future__ import annotations

import argparse
import sys
import urllib.request
from pathlib import Path

REPO_RAW = "https://raw.githubusercontent.com/RConsortium/submissions-pilot3-adam-to-fda/main"
SDTM_PATH = "m5/datasets/rconsortiumpilot3/tabulations/sdtm"

# Files we want for v0.1: 5 SDTM domains + define.xml.
# Upstream filenames are lowercase; we capitalize XPT names to match CDISC convention.
FILES: list[tuple[str, str]] = [
    ("dm.xpt", "DM.xpt"),
    ("ae.xpt", "AE.xpt"),
    ("lb.xpt", "LB.xpt"),
    ("ex.xpt", "EX.xpt"),
    ("vs.xpt", "VS.xpt"),
    ("define.xml", "define.xml"),
]


def download(url: str, target: Path) -> int:
    request = urllib.request.Request(url, headers={"User-Agent": "landing-zone-fetch/0.1"})
    with urllib.request.urlopen(request) as response:
        data = response.read()
    target.write_bytes(data)
    return len(data)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force", action="store_true", help="Re-download files even if they already exist")
    args = parser.parse_args()

    here = Path(__file__).resolve().parent
    clean = here / "clean"
    clean.mkdir(exist_ok=True)

    total_bytes = 0
    for remote_name, local_name in FILES:
        target = clean / local_name
        if target.exists() and not args.force:
            print(f"skip   {local_name} (already present)", file=sys.stderr)
            continue
        url = f"{REPO_RAW}/{SDTM_PATH}/{remote_name}"
        size = download(url, target)
        total_bytes += size
        print(f"fetch  {local_name:14s}  {size / 1024:>10,.1f} KiB", file=sys.stderr)

    print(f"done. wrote {total_bytes / 1024 / 1024:.2f} MiB to {clean}", file=sys.stderr)


if __name__ == "__main__":
    main()
