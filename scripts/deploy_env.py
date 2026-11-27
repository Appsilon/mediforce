"""Read the deployment .env the way `source .env` and Docker Compose do.

Shared by the host scripts (heartbeat.py, cron-jobs.py). Python puts the
script's directory on sys.path, so they import it as `deploy_env`.
"""

from __future__ import annotations

import re
from pathlib import Path

INLINE_COMMENT = re.compile(r"\s+#.*$")


def parse_value(raw: str) -> str:
    """A quoted value is taken verbatim; an unquoted one loses its ` # comment`."""
    value = raw.strip()
    if value[:1] in ("'", '"'):
        closing = value.find(value[0], 1)
        if closing != -1:
            return value[1:closing]
    return INLINE_COMMENT.sub("", value)


def read_env_file(path: Path) -> dict[str, str]:
    """Every KEY=value in `path`, or {} when the file is missing."""
    if path.is_file() is False:
        return {}
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if stripped == "" or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        values[key.removeprefix("export ").strip()] = parse_value(value)
    return values
