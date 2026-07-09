"""Landing Zone Demo Console — tiny FastAPI app.

GET /          serves index.html
GET /scenarios returns the catalog (consumed by the SPA + workflow)
POST /seed     wipes the SFTP upload dir, uploads one scenario from local
               sample-data via paramiko SFTP (X-Api-Key required)

Designed to run on the same host as the SFTP server, where it talks to
localhost:22 as the SFTP user — that way no shell write access to the
SFTP user's chrooted upload dir is needed.

Run:
    DEMO_CONSOLE_API_KEY=$(openssl rand -hex 16) \\
    SFTP_HOST=127.0.0.1 SFTP_USER=sftpuser SFTP_PASSWORD=... \\
    EXAMPLES_DIR=/home/deploy/lz-examples \\
    python3 -m uvicorn app:app --host 0.0.0.0 --port 8080
"""

from __future__ import annotations

import os
import secrets
import time
from pathlib import Path
from stat import S_ISDIR

import paramiko
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

LATE_OFFSET_DAYS = 14
SECONDS_PER_DAY = 86400

# (key, label, hint, variant, only-filter, late?, intent)
SCENARIOS = [
    ("smoke-clean",       "Clean delivery — DM only",   "Fast: 111KB DM.xpt, no findings.",                "clean",                    ["DM.xpt"], False, "success"),
    ("full-clean",        "Clean weekly delivery — full", "Full clean SDTM (5 files, ~60MB).",             "clean",                    None,       False, "success"),
    ("smoke-broken",      "Codifiable defects — DM only", "79KB DM.xpt, SEX=X + RFXSTDTC>RFXENDTC.",       "injection",                ["DM.xpt"], False, "warning"),
    ("full-broken",       "Full injection delivery",     "5 SDTM violations, ~40MB.",                      "injection",                None,       False, "warning"),
    ("demo-3findings",    "3 codifiable findings",       "DM/LB/AE + define — SEX outside CT, LB rows_distinct, AE→DM orphan.", "injection-demo", None, False, "warning"),
    ("chaos-encoding",    "Encoding chaos",              "DM with CP1252 bytes — UnicodeDecodeError path.","mess-encoding",            ["DM.xpt"], False, "warning"),
    ("mess-inconsistent", "Inconsistent SITEID values",  "DM with rotating SITEID: NY / New York.",        "mess-inconsistent-values", ["DM.xpt"], False, "warning"),
    ("missing-domain",    "Missing AE.xpt",              "Clean minus AE.xpt — pre-flight finding.",       "mess-missing-domain",      None,       False, "warning"),
    ("late-delivery",     "Late delivery (14d)",         "Mtimes backdated 14 days — cadence breach.",     "clean",                    None,       True,  "warning"),
]
_BY_KEY = {s[0]: s for s in SCENARIOS}

EXAMPLES_DIR = Path(os.environ.get("EXAMPLES_DIR", "/home/deploy/lz-examples"))
SFTP_HOST = os.environ.get("SFTP_HOST", "127.0.0.1")
SFTP_PORT = int(os.environ.get("SFTP_PORT", "22"))
SFTP_USER = os.environ.get("SFTP_USER", "")
SFTP_PASSWORD = os.environ.get("SFTP_PASSWORD", "")
SFTP_UPLOAD_DIR = os.environ.get("SFTP_UPLOAD_DIR", "/uploads")  # remote view (chrooted)
API_KEY = os.environ.get("DEMO_CONSOLE_API_KEY", "")
INDEX_HTML = Path(__file__).parent / "index.html"

app = FastAPI(title="landing-zone-demo-console")


class SeedRequest(BaseModel):
    scenario: str = Field(min_length=1, max_length=64)


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    return HTMLResponse(INDEX_HTML.read_text(encoding="utf-8"))


@app.get("/scenarios")
def list_scenarios() -> dict:
    return {"scenarios": [
        {"key": k, "label": l, "hint": h, "variant": v, "only": o, "late": late, "intent": intent}
        for k, l, h, v, o, late, intent in SCENARIOS
    ]}


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.post("/seed")
def seed(req: SeedRequest, x_api_key: str | None = Header(default=None)) -> JSONResponse:
    if not API_KEY:
        raise HTTPException(500, "DEMO_CONSOLE_API_KEY unset")
    if not secrets.compare_digest(x_api_key or "", API_KEY):
        raise HTTPException(401, "invalid api key")
    if req.scenario not in _BY_KEY:
        raise HTTPException(400, f"unknown scenario: {req.scenario!r}")
    if not (SFTP_USER and SFTP_PASSWORD):
        raise HTTPException(500, "SFTP_USER / SFTP_PASSWORD unset")

    _, _, _, variant, only, late, _ = _BY_KEY[req.scenario]
    started = time.monotonic()
    try:
        files = _run_seed(variant, only, late)
    except FileNotFoundError as exc:
        raise HTTPException(500, str(exc))
    except (OSError, paramiko.SSHException) as exc:
        raise HTTPException(500, f"sftp error: {exc}")

    return JSONResponse({
        "ok": True,
        "scenario": req.scenario,
        "files": files,
        "duration_ms": int((time.monotonic() - started) * 1000),
    })


def _run_seed(variant: str, only: list[str] | None, late: bool) -> list[str]:
    source_dir = EXAMPLES_DIR / variant
    if not source_dir.is_dir():
        raise FileNotFoundError(f"pre-staged source missing: {source_dir}")

    sources = [source_dir / name for name in only] if only else sorted(source_dir.iterdir())
    if only:
        for src in sources:
            if not src.is_file():
                raise FileNotFoundError(f"missing under examples: {src}")

    # Late-delivery backdates 14d; everything else stamps to now so a repeat
    # seed still triggers sftp-poll's (filename, size, mtime) diff.
    timestamp = time.time() - (LATE_OFFSET_DAYS * SECONDS_PER_DAY) if late else time.time()

    transport = paramiko.Transport((SFTP_HOST, SFTP_PORT))
    transport.connect(username=SFTP_USER, password=SFTP_PASSWORD)
    try:
        sftp = paramiko.SFTPClient.from_transport(transport)
        if sftp is None:
            raise paramiko.SSHException("failed to open SFTP channel")
        try:
            _wipe(sftp, SFTP_UPLOAD_DIR)
            copied: list[str] = []
            for src in sources:
                remote = f"{SFTP_UPLOAD_DIR.rstrip('/')}/{src.name}"
                sftp.put(str(src), remote)
                sftp.utime(remote, (timestamp, timestamp))
                copied.append(src.name)
            return copied
        finally:
            sftp.close()
    finally:
        transport.close()


def _wipe(sftp: paramiko.SFTPClient, remote_dir: str) -> None:
    for entry in sftp.listdir_attr(remote_dir):
        if entry.filename.startswith("."):
            continue
        target = f"{remote_dir.rstrip('/')}/{entry.filename}"
        if S_ISDIR(entry.st_mode or 0):
            _wipe(sftp, target)
            sftp.rmdir(target)
        else:
            sftp.remove(target)
