"""Validation step for the landing-zone workflow.

Reads the most recent delivery dropped into /workspace/incoming/ by sftp-poll,
runs the CDISC CORE rules engine against it, and writes structured findings to
both /workspace (audit trail via run worktree commit) and /output (engine I/O).

The script catches its own exceptions and ALWAYS exits 0. The next step
(interpret-validation, an LLM agent) reads `scriptStatus` from the result and
adapts: on `ok` it summarizes findings; on `failed` it surfaces the failure
prominently to the human reviewer and attempts to extract any partial signal.

Inputs:
  /workspace/incoming/{deliveryId}/*.xpt — files downloaded by sftp-poll
  env: VALIDATION_STANDARD (sdtm/adam), VALIDATION_IG_VERSION (e.g. 3.4)

Outputs:
  /output/result.json:
    {
      "scriptStatus": "ok" | "failed",
      "deliveryDir":  "incoming/d-..." or null,
      "findings":     {...} | null,         # raw CORE engine output
      "findingsCount": int,                 # zero on failure
      "error":        str (on failure),
      "traceback":    str (on failure)
    }
  /workspace/findings.json — same content as result.json (audit trail)
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import traceback
from pathlib import Path
from typing import Any

OUTPUT = Path("/output")
WORKSPACE = Path("/workspace")


def find_latest_delivery() -> Path | None:
    incoming = WORKSPACE / "incoming"
    if not incoming.exists():
        return None
    deliveries = [path for path in incoming.iterdir() if path.is_dir()]
    if not deliveries:
        return None
    return max(deliveries, key=lambda path: path.stat().st_mtime)


def run_cdisc_core(delivery: Path, output_path: Path) -> dict[str, Any]:
    standard = os.environ.get("VALIDATION_STANDARD", "sdtm")
    ig_version = os.environ.get("VALIDATION_IG_VERSION", "3.4")
    args = [
        "core",
        "validate",
        "--standard", standard,
        "--version", ig_version,
        "--dataset-path", str(delivery),
        "--output", str(output_path),
        "--output-format", "JSON",
    ]
    proc = subprocess.run(args, capture_output=True, text=True, timeout=600)
    if proc.returncode != 0:
        raise RuntimeError(
            f"core validate failed (exit {proc.returncode}): "
            f"{proc.stderr.strip() or proc.stdout.strip() or '(no output)'}"
        )
    return json.loads(output_path.read_text())


def write_result(payload: dict[str, Any]) -> None:
    (OUTPUT / "result.json").write_text(json.dumps(payload, indent=2))
    (WORKSPACE / "findings.json").write_text(json.dumps(payload, indent=2))


def count_findings(findings: dict[str, Any] | None) -> int:
    if not isinstance(findings, dict):
        return 0
    issues = findings.get("issues") or findings.get("results") or []
    if isinstance(issues, list):
        return len(issues)
    return 0


def main() -> None:
    delivery = find_latest_delivery()
    if delivery is None:
        write_result({
            "scriptStatus": "failed",
            "deliveryDir": None,
            "findings": None,
            "findingsCount": 0,
            "error": "No delivery directory found in /workspace/incoming",
            "traceback": "",
        })
        return

    delivery_rel = str(delivery.relative_to(WORKSPACE))
    findings_path = delivery.parent / "findings.json"

    try:
        findings = run_cdisc_core(delivery, findings_path)
        write_result({
            "scriptStatus": "ok",
            "deliveryDir": delivery_rel,
            "findings": findings,
            "findingsCount": count_findings(findings),
        })
        print(f"validate: ok, {count_findings(findings)} finding(s)", file=sys.stderr)
    except Exception as error:
        write_result({
            "scriptStatus": "failed",
            "deliveryDir": delivery_rel,
            "findings": None,
            "findingsCount": 0,
            "error": f"{type(error).__name__}: {error}",
            "traceback": traceback.format_exc(),
        })
        print(f"validate: FAILED — {error}", file=sys.stderr)


if __name__ == "__main__":
    main()
