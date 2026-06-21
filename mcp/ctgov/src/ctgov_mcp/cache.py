"""Optional snapshot writer for reproducibility.

When ``CTGOV_SNAPSHOT_DIR`` is set, every successful API response is also written to disk
keyed by endpoint + params, so the downstream pipeline can replay runs fully offline
against pinned fixtures. This is best-effort: a snapshot write failure never breaks a tool
call (the API result is still returned).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any, Mapping

_ENV_DIR = "CTGOV_SNAPSHOT_DIR"
_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def snapshot_dir() -> Path | None:
    """Return the configured snapshot directory, or None if snapshotting is off."""
    raw = os.environ.get(_ENV_DIR)
    return Path(raw).expanduser() if raw else None


def _slug(text: str) -> str:
    return _SAFE.sub("_", text).strip("_") or "root"


def _filename(path: str, params: Mapping[str, Any]) -> str:
    """Build a stable, readable filename from the endpoint path and sorted params."""
    base = _slug(path.strip("/"))
    if not params:
        return f"{base}.json"
    items = sorted((str(k), str(v)) for k, v in params.items() if v is not None)
    if not items:
        return f"{base}.json"
    digest = hashlib.sha1(json.dumps(items, sort_keys=True).encode()).hexdigest()[:10]
    hint = _slug("_".join(f"{k}-{v}" for k, v in items))[:60]
    return f"{base}__{hint}__{digest}.json"


def write_snapshot(path: str, params: Mapping[str, Any] | None, payload: Any) -> Path | None:
    """Write ``payload`` to the snapshot dir if configured. Returns the path written, or None.

    Best-effort: swallows IO errors so snapshotting never breaks a tool call.
    """
    base = snapshot_dir()
    if base is None:
        return None
    try:
        base.mkdir(parents=True, exist_ok=True)
        target = base / _filename(path, params or {})
        target.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        return target
    except OSError:
        return None
