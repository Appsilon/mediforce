#!/usr/bin/env python3
"""Stage 3+4 — resolve the CDASH specification for the domains the USDM implies.

Uses the cdisclib package's CdiscLibraryClient (same client the MCP server wraps) to pull:
  * CDASHIG 2.3 domain field lists (/mdr/cdashig/2-3/domains/{domain})
  * each coded field's Controlled Terminology terms, pinned to a CT package
  * each field's SDTM mapping target (CDASH -> SDTM traceability), from the field _links

Inputs : 01_usdm/soa.json, 01_usdm/usdm.json
Outputs: 02_cdash_spec/cdash_spec.json  — per-domain ordered field specs + CT + provenance
         02_cdash_spec/ct_cache.json     — fetched codelists (submission values), pinned package
         02_cdash_spec/coverage.json      — which implied domains are populated vs deferred
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Use the cdisclib package shipped in this repo.
sys.path.insert(0, str(Path(__file__).parents[1] / "mcp/cdisclib/src"))
from cdisclib_mcp.client import CdiscLibraryClient, CdiscNotFound  # noqa: E402

HERE = Path(__file__).parent
CDASHIG = "2-3"
CT_PACKAGE = "sdtmct-2026-03-27"  # pinned for reproducibility (manifest)

SOA = json.loads((HERE / "01_usdm/soa.json").read_text())

# Domains we resolve a full spec for AND populate in Stage 5.
POPULATED = ["DM", "IE", "MH", "VS", "EG", "LB", "EX", "CM", "AE", "DS"]
# Implied by the USDM but not populated in this MVP run (specs still listed in coverage).
DEFERRED = ["PC", "PE", "SU"]

client = CdiscLibraryClient(api_key=os.environ.get("CDISC_API_KEY"))
_ct_cache: dict[str, dict] = {}


def fetch_codelist(ncit: str) -> dict | None:
    if ncit in _ct_cache:
        return _ct_cache[ncit]
    try:
        cl = client.get(f"mdr/ct/packages/{CT_PACKAGE}/codelists/{ncit}")
    except CdiscNotFound:
        _ct_cache[ncit] = None
        return None
    terms = [{"submissionValue": t.get("submissionValue"),
              "conceptId": t.get("conceptId"),
              "decode": t.get("preferredTerm") or (t.get("synonyms") or [None])[0]}
             for t in cl.get("terms", [])]
    rec = {"conceptId": ncit, "name": cl.get("name"),
           "extensible": cl.get("extensible"), "package": CT_PACKAGE, "terms": terms}
    _ct_cache[ncit] = rec
    return rec


def link_tail(field: dict, rel: str) -> str | None:
    v = field.get("_links", {}).get(rel)
    if not v:
        return None
    v = v[0] if isinstance(v, list) else v
    return (v.get("href") or "").split("/")[-1] or None


def domain_fields(domain: str) -> list[dict]:
    """Return the field list for a CDASHIG domain (falling back to a scenario for DM)."""
    rec = client.get(f"mdr/cdashig/{CDASHIG}/domains/{domain}")
    fields = rec.get("fields", [])
    if not fields:  # special-purpose domains (e.g. DM) carry fields under a scenario
        scenarios = rec.get("_links", {}).get("scenarios", [])
        for sc in scenarios:
            sid = sc["href"].split("/")[-1]
            if "singledatefield" in sid.lower():
                fields = client.get(f"mdr/cdashig/{CDASHIG}/scenarios/{sid}").get("fields", [])
                break
        if not fields and scenarios:
            sid = scenarios[0]["href"].split("/")[-1]
            fields = client.get(f"mdr/cdashig/{CDASHIG}/scenarios/{sid}").get("fields", [])
    return fields


# activities feeding each domain, for provenance
acts_by_domain: dict[str, list] = {}
for a in SOA["activities"]:
    acts_by_domain.setdefault(a["targetCdashDomain"], []).append(
        {"activityId": a["id"], "activityName": a["name"],
         "bcNcit": a["biomedicalConceptNcit"], "protocolPage": a["provenance"]["protocolPage"]})

spec = {"studyId": SOA["studyId"], "cdashigVersion": CDASHIG, "ctPackage": CT_PACKAGE, "domains": {}}

for dom in POPULATED:
    fields = domain_fields(dom)
    out_fields = []
    for f in fields:
        ncit = link_tail(f, "codelist")
        sdtm = link_tail(f, "sdtmigDatasetMappingTargets")
        cl = fetch_codelist(ncit) if ncit else None
        out_fields.append({
            "name": f["name"],
            "label": f.get("label"),
            "order": f.get("ordinal"),
            "core": f.get("core"),                      # HR / R/C / O
            "dataType": f.get("simpleDatatype"),
            "prompt": f.get("prompt"),
            "questionText": f.get("questionText"),
            "definition": (f.get("definition") or "")[:300],
            "codelistNcit": ncit,
            "codelistName": cl["name"] if cl else None,
            "sdtmTarget": sdtm,                          # CDASH -> SDTM traceability
        })
    spec["domains"][dom] = {
        "label": next((d for d in []), None) or dom,
        "sourceActivities": acts_by_domain.get(dom, []),
        "fieldCount": len(out_fields),
        "fields": out_fields,
    }
    print(f"{dom}: {len(out_fields)} fields, "
          f"{sum(1 for x in out_fields if x['codelistNcit'])} coded")

(HERE / "02_cdash_spec/cdash_spec.json").write_text(json.dumps(spec, indent=2, ensure_ascii=False))
(HERE / "02_cdash_spec/ct_cache.json").write_text(
    json.dumps({k: v for k, v in _ct_cache.items() if v}, indent=2, ensure_ascii=False))

coverage = {
    "impliedDomains": sorted({a["targetCdashDomain"] for a in SOA["activities"]}),
    "populated": POPULATED,
    "deferred": {d: "spec resolvable from CDASHIG; not populated in this MVP run" for d in DEFERRED},
    "ctPackagePinned": CT_PACKAGE,
    "cdashigVersion": CDASHIG,
}
(HERE / "02_cdash_spec/coverage.json").write_text(json.dumps(coverage, indent=2, ensure_ascii=False))
print(f"\nCT codelists fetched: {sum(1 for v in _ct_cache.values() if v)}")
print("Wrote 02_cdash_spec/{cdash_spec,ct_cache,coverage}.json")
