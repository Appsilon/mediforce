#!/usr/bin/env python3
"""Stage 6 (light) — validate the synthetic CDASH datasets.

Checks (reported, per dataset):
  * mandatory identifiers present & non-empty (STUDYID, SITEID, SUBJID)
  * key uniqueness: STUDYID + SUBJID + <DOMAIN>SEQ unique where a --SEQ exists
  * CT membership for selected coded fields against the pinned codelists
  * provenance columns (SRCACT, SRCPAGE) populated on findings/intervention domains

Output: 03_synthetic_cdash/validation_report.json
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "03_synthetic_cdash"
CT = json.loads((HERE / "02_cdash_spec/ct_cache.json").read_text())


def ct_set(ncit):
    rec = CT.get(ncit)
    return {t["submissionValue"] for t in rec["terms"]} if rec else set()


# field -> codelist NCIt to check membership against
CODED_CHECKS = {
    "SEX": "C66731", "AESEV": "C66769", "AESER": "C66742", "AEREL": "C66742",
    "MHONGO": "C66742", "CMONGO": "C66742", "VSPOS": "C71148",
}
SEQ_COL = {"VS": "VSSEQ", "EG": "EGSEQ", "LB": "LBSEQ", "EX": "EXSEQ", "CM": "CMSEQ",
           "AE": "AESEQ", "MH": "MHSEQ", "DS": "DSSEQ"}

report = {}
for csv_path in sorted(OUT.glob("*.csv")):
    dom = csv_path.stem
    with csv_path.open() as f:
        rows = list(csv.DictReader(f))
    checks = {"rows": len(rows), "issues": []}
    if not rows:
        report[dom] = checks
        continue
    hdr = rows[0].keys()

    # mandatory identifiers
    for key in ("STUDYID", "SITEID", "SUBJID"):
        if key in hdr:
            missing = sum(1 for r in rows if not r[key])
            if missing:
                checks["issues"].append(f"{key}: {missing} empty")

    # key uniqueness
    seqc = SEQ_COL.get(dom)
    if seqc and seqc in hdr:
        keys = [(r["STUDYID"], r["SUBJID"], r[seqc]) for r in rows]
        dupes = len(keys) - len(set(keys))
        checks["keyUnique"] = dupes == 0
        if dupes:
            checks["issues"].append(f"{dupes} duplicate STUDYID+SUBJID+{seqc} keys")

    # CT membership
    ct_results = {}
    for field, ncit in CODED_CHECKS.items():
        if field in hdr:
            allowed = ct_set(ncit)
            if not allowed:
                continue
            bad = sorted({r[field] for r in rows if r[field] and r[field] not in allowed})
            ct_results[field] = {"codelist": ncit, "inCT": not bad, "violations": bad}
            if bad:
                checks["issues"].append(f"{field}: values not in CT {ncit}: {bad}")
    if ct_results:
        checks["ctMembership"] = ct_results

    # provenance
    if "SRCACT" in hdr:
        miss = sum(1 for r in rows if not r["SRCACT"] or not r["SRCPAGE"])
        checks["provenanceComplete"] = miss == 0
        if miss:
            checks["issues"].append(f"{miss} rows missing SRCACT/SRCPAGE")

    checks["pass"] = not checks["issues"]
    report[dom] = checks

total_issues = sum(len(c["issues"]) for c in report.values())
overall = {"datasets": len(report), "totalIssues": total_issues,
           "allPass": total_issues == 0, "perDataset": report}
(OUT / "validation_report.json").write_text(json.dumps(overall, indent=2, ensure_ascii=False))

print(f"Validation: {len(report)} datasets, {total_issues} issues.")
for d, c in report.items():
    flag = "PASS" if c.get("pass", len(c["issues"]) == 0) else "FAIL"
    print(f"  {d:4} {flag}  rows={c['rows']:4}  "
          + (f"keyUnique={c.get('keyUnique')}" if 'keyUnique' in c else "")
          + (f"  CT={'ok' if all(v['inCT'] for v in c.get('ctMembership',{}).values()) else 'VIOL'}"
             if c.get('ctMembership') else ""))
print(f"\nOVERALL: {'ALL PASS' if overall['allPass'] else str(total_issues)+' ISSUES'}")
