#!/usr/bin/env python3
"""Write run manifest: pinned versions, parameters, and content hashes of every artifact."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

HERE = Path(__file__).parent
RAW = json.loads((HERE / "00_raw/NCT04556760.json").read_text())
VER = json.loads((HERE / "00_raw/ctgov_version.json").read_text())


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:16]


artifacts = {}
for p in sorted(HERE.rglob("*")):
    if p.is_file() and "__pycache__" not in p.parts and p.suffix in (".json", ".csv", ".pdf", ".py"):
        artifacts[str(p.relative_to(HERE))] = {"sha256_16": sha(p), "bytes": p.stat().st_size}

manifest = {
    "pipeline": "protocol-to-synthetic-CDASH (MVP test run)",
    "input": {"nctId": "NCT04556760",
              "sponsorStudyId": RAW["protocolSection"]["identificationModule"]["orgStudyIdInfo"]["id"],
              "title": RAW["protocolSection"]["identificationModule"]["briefTitle"]},
    "provenance": {
        "ctgovApiVersion": VER.get("apiVersion"),
        "ctgovDataTimestamp": VER.get("dataTimestamp"),
        "protocolDocument": "Prot_000.pdf (Clinical Study Protocol v3.0, dated 2021-03-03)",
        "protocolSoAPages": "20-24",
    },
    "standards": {
        "usdmVersion": "3.0.0",
        "cdashigVersion": "2.3",
        "ctPackage": "sdtmct-2026-03-27",
        "cdashMappedToSdtmig": "3.4 (via field sdtmigDatasetMappingTargets)",
    },
    "parameters": {"subjectCount": 40, "randomSeed": 1234,
                   "cohorts": {"Cohort 1": 24, "Cohort 2": 8, "Cohort 3": 8},
                   "crossover": "two-way (AB/BA sequences)"},
    "tools": {"ctgov": "ctgov MCP (ClinicalTrials.gov API v2)",
              "cdisclib": "cdisclib client/MCP (CDISC Library API)"},
    "stages": {
        "1_fetch": "00_raw/NCT04556760.json (+ protocol/Prot_000.pdf)",
        "2_usdm": "01_usdm/usdm.json (+ soa.json)",
        "3_4_cdash_spec": "02_cdash_spec/cdash_spec.json (+ ct_cache.json, coverage.json)",
        "5_populate": "03_synthetic_cdash/*.csv (+ lineage.json, datasets_summary.json)",
        "6_validate": "03_synthetic_cdash/validation_report.json",
    },
    "artifacts": artifacts,
}
(HERE / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
print(f"Wrote manifest.json with {len(artifacts)} artifacts hashed.")
