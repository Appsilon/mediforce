"""Accept-delivery step for the landing-zone workflow.

Promotes the latest delivery in /workspace/incoming/ to the local data lake
under /workspace/lake/{studyId}/{deliveryId}/, computes a SHA-256 manifest
across all files for integrity, and writes a final status record.

Inputs:
  /workspace/incoming/{deliveryId}/*  — files vetted by validate-script + human
  env: STUDY_ID

Outputs:
  /workspace/lake/{studyId}/{deliveryId}/*           — promoted files
  /workspace/lake/{studyId}/{deliveryId}/manifest.json — sha256 + size per file
  /output/result.json:
    {
      "status": "accepted",
      "studyId": "...",
      "deliveryId": "d-...",
      "lakePath": "lake/{studyId}/{deliveryId}",
      "fileCount": int,
      "totalBytes": int
    }
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

OUTPUT = Path("/output")
WORKSPACE = Path("/workspace")
CHUNK = 1 << 20


def find_latest_delivery() -> Path | None:
    incoming = WORKSPACE / "incoming"
    if not incoming.exists():
        return None
    deliveries = [path for path in incoming.iterdir() if path.is_dir()]
    if not deliveries:
        return None
    return max(deliveries, key=lambda path: path.stat().st_mtime)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(CHUNK)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    delivery = find_latest_delivery()
    if delivery is None:
        raise RuntimeError("No delivery directory found in /workspace/incoming")

    study_id = os.environ.get("STUDY_ID", "unknown-study")
    delivery_id = delivery.name
    lake_dir = WORKSPACE / "lake" / study_id / delivery_id
    lake_dir.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, dict[str, int | str]] = {}
    total_bytes = 0
    for source in sorted(delivery.iterdir()):
        if not source.is_file():
            continue
        target = lake_dir / source.name
        shutil.copy2(source, target)
        size = target.stat().st_size
        digest = sha256(target)
        manifest[source.name] = {"size": size, "sha256": digest}
        total_bytes += size

    (lake_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))

    result = {
        "status": "accepted",
        "studyId": study_id,
        "deliveryId": delivery_id,
        "lakePath": str(lake_dir.relative_to(WORKSPACE)),
        "fileCount": len(manifest),
        "totalBytes": total_bytes,
    }
    (OUTPUT / "result.json").write_text(json.dumps(result, indent=2))
    print(
        f"accept-delivery: {len(manifest)} file(s) "
        f"({total_bytes} bytes) → {result['lakePath']}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
