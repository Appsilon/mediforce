#!/usr/bin/env python3
"""Stage 1 — fetch and persist the ClinicalTrials.gov study record.

Inputs : NCT id (argv[1] or env NCT_ID; defaults to the reference trial NCT04556760).
Outputs: 00_raw/<NCT>.json          — verbatim CT.gov API v2 record (Stage-2 input)
         00_raw/ctgov_version.json  — {apiVersion, dataTimestamp} provenance anchor
         protocol/<filename>.pdf     — protocol / SAP PDFs from the CDN, when present
         protocol/<filename>.txt     — extracted text (when pdftotext is available)

Deterministic per the spec (§5 Stage 1): GET the study, persist it verbatim, capture the
dataTimestamp for the manifest, and download the large protocol documents. Reuses the
ctgov MCP server's CtGovClient (backoff + 404 handling) rather than re-implementing HTTP.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import httpx

HERE = Path(__file__).parent
# Run from source too: the CtGovClient lives in the ctgov MCP server package.
sys.path.insert(0, str(HERE.parents[0] / "mcp/ctgov/src"))

from ctgov_mcp.client import CtGovClient, CtGovNotFound  # noqa: E402

CDN_BASE = "https://cdn.clinicaltrials.gov/large-docs"
PDF_USER_AGENT = "ctgov-mcp/0.1.0 (+protocol-to-synthetic-sdtm)"


def large_doc_url(nct_id: str, filename: str) -> str:
    """CDN path for a study's large document: .../large-docs/<last-2-digits>/<NCT>/<file>."""
    return f"{CDN_BASE}/{nct_id[-2:]}/{nct_id}/{filename}"


def download_pdf(url: str, dest: Path) -> None:
    with httpx.Client(timeout=60.0, follow_redirects=True, headers={"User-Agent": PDF_USER_AGENT}) as client:
        with client.stream("GET", url) as resp:
            resp.raise_for_status()
            with dest.open("wb") as handle:
                for chunk in resp.iter_bytes():
                    handle.write(chunk)


def extract_text(pdf: Path) -> bool:
    """Best-effort text extraction via poppler's pdftotext (present in the agent image)."""
    if shutil.which("pdftotext") is None:
        return False
    subprocess.run(["pdftotext", "-layout", str(pdf), str(pdf.with_suffix(".txt"))], check=True)
    return True


def main() -> None:
    nct_id = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get("NCT_ID", "NCT04556760")).strip().upper()
    if not nct_id.startswith("NCT"):
        sys.exit(f"Invalid NCT id '{nct_id}' (expected to start with 'NCT').")

    raw_dir = HERE / "00_raw"
    protocol_dir = HERE / "protocol"
    raw_dir.mkdir(exist_ok=True)
    protocol_dir.mkdir(exist_ok=True)

    with CtGovClient() as client:
        try:
            record = client.get(f"studies/{nct_id}", {"markupFormat": "markdown", "format": "json"})
        except CtGovNotFound:
            sys.exit(f"No study found for '{nct_id}'. Check the NCT id at clinicaltrials.gov.")
        version = client.get("version")

    (raw_dir / f"{nct_id}.json").write_text(json.dumps(record, indent=2))
    (raw_dir / "ctgov_version.json").write_text(json.dumps(version, indent=2))
    print(f"Fetched {nct_id} (dataTimestamp {version.get('dataTimestamp')}) -> 00_raw/{nct_id}.json")

    large_docs = (
        record.get("documentSection", {})
        .get("largeDocumentModule", {})
        .get("largeDocs", [])
    )
    if not large_docs:
        print("No large documents (protocol/SAP PDF) registered for this study.")
        return

    for doc in large_docs:
        filename = doc.get("filename")
        if not filename:
            continue
        dest = protocol_dir / filename
        try:
            download_pdf(large_doc_url(nct_id, filename), dest)
        except httpx.HTTPError as exc:
            print(f"  ! could not download {filename}: {exc}")
            continue
        extracted = extract_text(dest)
        suffix = " (+ .txt)" if extracted else ""
        print(f"  downloaded {doc.get('label', filename)} -> protocol/{filename}{suffix}")


if __name__ == "__main__":
    main()
