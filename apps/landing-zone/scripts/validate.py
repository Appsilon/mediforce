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


def normalise_standard(value: str) -> str:
    # The CDISC CORE CLI accepts `sdtmig` / `adamig` etc. (no separator).
    # WD env may carry `sdtm` / `SDTM` / `sdtm-ig` from study config —
    # collapse to the shape the CLI expects.
    cleaned = value.strip().lower().replace("-", "").replace("_", "")
    if cleaned == "sdtm":
        return "sdtmig"
    if cleaned == "adam":
        return "adamig"
    return cleaned


def normalise_version(value: str) -> str:
    # CLI wants the version as a hyphen-separated string ("3-4"), not a dot
    # ("3.4"). Both shapes appear in study configs depending on author.
    return value.strip().replace(".", "-")


def run_cdisc_core(delivery: Path, output_path: Path) -> dict[str, Any]:
    standard = normalise_standard(os.environ.get("VALIDATION_STANDARD", "sdtm"))
    ig_version = normalise_version(os.environ.get("VALIDATION_IG_VERSION", "3-4"))

    # Output flag wants a basename (no extension). The CLI appends the format
    # extension itself (e.g. `--output reports/result --output-format json`
    # produces `reports/result.json`). We strip any trailing `.json` so the
    # downstream read still finds the file.
    output_basename = str(output_path)
    if output_basename.endswith(".json"):
        output_basename = output_basename[:-5]
    expected_output = Path(output_basename + ".json")

    # core.py wants individual --dataset-path entries, one per file. Pass
    # every regular file in the delivery dir; non-XPT files (e.g. define.xml)
    # are filtered out so the engine doesn't choke on unsupported formats.
    dataset_files = sorted(
        path for path in delivery.iterdir()
        if path.is_file() and path.suffix.lower() == ".xpt"
    )
    if not dataset_files:
        raise RuntimeError(
            f"No .xpt datasets found in {delivery} — nothing to validate"
        )

    args = [
        "python", "/opt/cdisc/core.py",
        "validate",
        "--standard", standard,
        "--version", ig_version,
        "--output", output_basename,
        "--output-format", "json",
    ]
    for dataset in dataset_files:
        args.extend(["--dataset-path", str(dataset)])

    proc = subprocess.run(
        args,
        capture_output=True,
        text=True,
        timeout=600,
        cwd="/opt/cdisc",
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"core validate failed (exit {proc.returncode}): "
            f"{proc.stderr.strip() or proc.stdout.strip() or '(no output)'}"
        )
    if not expected_output.exists():
        raise RuntimeError(
            f"core validate produced no output at {expected_output}. "
            f"stdout: {proc.stdout.strip() or '(empty)'}"
        )
    return json.loads(expected_output.read_text())


def write_result(payload: dict[str, Any]) -> None:
    """Write the small result envelope to /output/result.json.

    The full findings payload — which can be 1+ MB on a real delivery —
    goes to /workspace/findings.json instead. Firestore caps documents at
    1 MiB and the auto-runner persists the step result into the instance
    document, so anything we put in result.json must stay well under that.
    The interpret-validation step reads /workspace/findings.json (audit
    trail) for the long form.
    """
    (OUTPUT / "result.json").write_text(json.dumps(payload, indent=2))


def write_findings(findings: dict[str, Any] | None) -> None:
    if findings is None:
        return
    (WORKSPACE / "findings.json").write_text(json.dumps(findings, indent=2))


def count_findings(findings: dict[str, Any] | None) -> int:
    """Total number of underlying issues across all rules.

    The CDISC CORE 0.15 JSON shape is `{"Issue_Summary": [{"issues": int, ...}, ...]}`.
    Each entry counts how many rows of a dataset matched a rule. We sum the
    `issues` field per entry to get a total. Older shapes (`issues` /
    `results` arrays at the top level) are kept as fallbacks.
    """
    if not isinstance(findings, dict):
        return 0

    summary = findings.get("Issue_Summary")
    if isinstance(summary, list):
        total = 0
        for entry in summary:
            if isinstance(entry, dict):
                count = entry.get("issues")
                if isinstance(count, int):
                    total += count
        return total

    issues = findings.get("issues") or findings.get("results") or []
    if isinstance(issues, list):
        return len(issues)
    return 0


def summarise_findings(findings: dict[str, Any] | None) -> dict[str, Any]:
    """Compact summary suitable for the step output envelope.

    Includes:
      - per-dataset rule + issue counts
      - top N rule findings (rule id + message + total issues)
    Excludes the per-row Issue_Details payload which dominates size.
    """
    if not isinstance(findings, dict):
        return {"datasets": [], "topRules": []}

    summary = findings.get("Issue_Summary")
    by_dataset: dict[str, dict[str, int]] = {}
    rule_rows: list[dict[str, Any]] = []
    if isinstance(summary, list):
        for entry in summary:
            if not isinstance(entry, dict):
                continue
            dataset = str(entry.get("dataset", ""))
            issues = entry.get("issues") if isinstance(entry.get("issues"), int) else 0
            slot = by_dataset.setdefault(dataset, {"rules": 0, "issues": 0})
            slot["rules"] += 1
            slot["issues"] += issues
            rule_rows.append({
                "dataset": dataset,
                "coreId": str(entry.get("core_id", "")),
                "message": str(entry.get("message", ""))[:200],
                "issues": issues,
            })

    rule_rows.sort(key=lambda row: row["issues"], reverse=True)

    # Conformance metadata (small) and Dataset_Details (1 line per dataset)
    # are useful in the result envelope; only Issue_Details is large.
    return {
        "conformance": findings.get("Conformance_Details"),
        "datasetDetails": findings.get("Dataset_Details"),
        "datasetSummary": [
            {"dataset": ds, **counts} for ds, counts in sorted(by_dataset.items())
        ],
        "topRules": rule_rows[:30],
        "totalRulesWithIssues": len(rule_rows),
    }


def main() -> None:
    delivery = find_latest_delivery()
    if delivery is None:
        write_result({
            "scriptStatus": "failed",
            "deliveryDir": None,
            "findingsCount": 0,
            "summary": None,
            "error": "No delivery directory found in /workspace/incoming",
            "traceback": "",
        })
        return

    delivery_rel = str(delivery.relative_to(WORKSPACE))
    findings_path = delivery.parent / "findings.json"

    try:
        findings = run_cdisc_core(delivery, findings_path)
        write_findings(findings)
        write_result({
            "scriptStatus": "ok",
            "deliveryDir": delivery_rel,
            "findingsPath": "findings.json",
            "findingsCount": count_findings(findings),
            "summary": summarise_findings(findings),
        })
        print(f"validate: ok, {count_findings(findings)} finding(s)", file=sys.stderr)
    except Exception as error:
        write_result({
            "scriptStatus": "failed",
            "deliveryDir": delivery_rel,
            "findingsPath": None,
            "findingsCount": 0,
            "summary": None,
            "error": f"{type(error).__name__}: {error}",
            "traceback": traceback.format_exc(),
        })
        print(f"validate: FAILED — {error}", file=sys.stderr)


if __name__ == "__main__":
    main()
