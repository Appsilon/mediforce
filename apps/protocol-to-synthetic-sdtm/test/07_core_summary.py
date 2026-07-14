#!/usr/bin/env python3
"""Digest the CORE JSON report into a categorized summary for evaluation.

Reads 07_core_report/core_sdtmig34.json and writes summary.json, classifying each rule-finding
into: data_bug (our generator should fix), tabulation_gap (SDTM derivation not yet implemented),
or harness (artifact of running CSV without a Define-XML).
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

HERE = Path(__file__).parent
REP = json.loads((HERE / "07_core_report/core_sdtmig34.json").read_text())

CATEGORY = {
    # genuine synthetic-data inconsistencies our model should fix
    "CORE-000005": "data_bug",   # EXTRT=PLACEBO but EXDOSE != 0
    "CORE-000657": "data_bug",   # AEENDTC populated when AEOUT = NOT RECOVERED/NOT RESOLVED
    # SDTM derivations not implemented in this tabulation pass
    "CORE-000701": "tabulation_gap",  # EPOCH missing
    "CORE-000321": "tabulation_gap",  # --DY missing (VS/LB)
    "CORE-000328": "tabulation_gap",  # --STDY missing
    "CORE-000776": "tabulation_gap",  # --ENDY missing
    "CORE-000793": "tabulation_gap",  # collection study day missing
    "CORE-000852": "tabulation_gap",  # variable order vs IG
    "CORE-000334": "tabulation_gap",  # expected variable missing
    "CORE-000355": "tabulation_gap",  # required variable missing
    "CORE-001082": "tabulation_gap",  # datatype mismatch vs _variables.csv
    "CORE-000365": "tabulation_gap",  # MHCAT single generic group (best practice)
    "CORE-000767": "tabulation_gap",  # FA cross-domain check
    # artifacts of running CSV without a Define-XML / unprovided reference vars
    "CORE-001081": "harness",    # role per define-xml
    "CORE-000929": "harness",    # DOMAIN CT (rule execution error)
    "CORE-000238": "harness",    # RFXENDTC (not provided in DM)
    "CORE-000239": "harness",    # RFXSTDTC (not provided in DM)
}

rr = REP["Rules_Report"]
statuses = Counter((r.get("status") or "").upper() for r in rr)

by_cat = Counter()
findings = []
for r in REP["Issue_Summary"]:
    cid = r["core_id"]
    cat = CATEGORY.get(cid, "other")
    by_cat[cat] += 1
    findings.append({"dataset": r["dataset"], "coreId": cid, "issues": int(r["issues"]),
                     "category": cat, "message": r["message"]})

findings.sort(key=lambda x: (x["category"] != "data_bug", -x["issues"]))

summary = {
    "standard": f'{REP["Conformance_Details"]["Standard"]} {REP["Conformance_Details"]["Version"]}',
    "ctVersion": REP["Conformance_Details"]["CT_Version"],
    "engineVersion": REP["Conformance_Details"]["CORE_Engine_Version"],
    "datasetsValidated": [d.get("filename") or d.get("dataset") for d in REP["Dataset_Details"]],
    "rulesExecuted": len(rr),
    "ruleStatusCounts": dict(statuses),
    "rulesWithIssues": len(REP["Issue_Summary"]),
    "totalIssueRecords": sum(int(x["issues"]) for x in REP["Issue_Summary"]),
    "findingsByCategory": dict(by_cat),
    "interpretation": {
        "data_bug": "Genuine inconsistency in the synthetic generator — fix in Stage 5.",
        "tabulation_gap": "SDTM derivation not implemented in the CDASH->SDTM pass (EPOCH, "
                          "--DY study days, variable ordering, expected/required vars).",
        "harness": "Artifact of validating raw CSV without a Define-XML / unsupplied reference "
                   "variables; not a data-quality issue.",
    },
    "findings": findings,
}
(HERE / "07_core_report/summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False))

print(f"Standard {summary['standard']}  CT {summary['ctVersion']}  engine {summary['engineVersion']}")
print(f"Rules: {summary['ruleStatusCounts']}")
print(f"Rule-findings: {summary['rulesWithIssues']} (records flagged: {summary['totalIssueRecords']})")
print(f"By category: {summary['findingsByCategory']}")
print("\nGenuine data bugs to fix in the generator:")
for f in findings:
    if f["category"] == "data_bug":
        print(f"  {f['dataset']} {f['coreId']} x{f['issues']}: {f['message'][:75]}")
