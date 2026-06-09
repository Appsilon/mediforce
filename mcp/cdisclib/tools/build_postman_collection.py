#!/usr/bin/env python3
"""Regenerate cdisc-library.postman_collection.json from CDISC's published OpenAPI specs.

Self-contained: downloads the specs over HTTP and writes the Postman v2.1 collection next to
the cdisclib package. Run with the cdisclib venv (only needs the stdlib + httpx, both present):

    mcp/cdisclib/.venv/bin/python mcp/cdisclib/tools/build_postman_collection.py

Sources (all public, no auth needed to *download* the specs):
  * Core API  - official CDISC swagger (share-2.0/1.1.0), UNION the SwaggerHub community mirror
                (lexjansen/cdisc-library_api 1.8) for endpoints live in prod but absent from the
                official file (e.g. /mdr/rules, /mdr/products/QrsInstrument).
  * COSMoS v1/v2 - github.com/cdisc-org/COSMoS (BC + SDTM Dataset Specialization endpoints).

The collection groups every GET into the four specs the CDISC portal presents, with the core
API sub-foldered by OpenAPI tag. Auth is api-key header (the live API's scheme).
"""
from __future__ import annotations

import json
from collections import OrderedDict
from pathlib import Path

import httpx

# baseUrl includes /api so the same collection works against prod and the SwaggerHub mock
# (whose server URL stands in for .../api). Core paths start at /mdr; COSMoS at /cosmos/vN.
HOST = "https://library.cdisc.org/api"
OUT = Path(__file__).resolve().parents[1] / "cdisc-library.postman_collection.json"

SPECS = {
    "core_official": "https://www.cdisc.org/system/files/cdisc_library/api_documentation/CDISC1-share-2.0-1.1.0-swagger.json",
    "core_mirror": "https://api.swaggerhub.com/apis/lexjansen/cdisc-library_api/1.8",
    "cosmos_v1": "https://raw.githubusercontent.com/cdisc-org/COSMoS/main/openapi/cosmos_openapi_v1.json",
    "cosmos_v2": "https://raw.githubusercontent.com/cdisc-org/COSMoS/main/openapi/cosmos_openapi_v2.json",
}

MIRROR_NOTE = (
    "[Source: SwaggerHub mirror lexjansen/cdisc-library_api 1.8 - NOT in the official "
    "share-2.0/1.1.0 spec. Some mirror-only paths are live (e.g. /mdr/rules, "
    "/mdr/products/QrsInstrument); others 404. Verify before relying on it.]"
)


def fetch(url: str) -> dict:
    r = httpx.get(url, follow_redirects=True, timeout=60.0)
    r.raise_for_status()
    return r.json()


def resolve_ref(doc, ref):
    node = doc
    for part in ref.lstrip("#/").split("/"):
        node = node[part]
    return node


def op_params(doc, path_item, op):
    raw = (path_item.get("parameters", []) or []) + (op.get("parameters", []) or [])
    return [resolve_ref(doc, p["$ref"]) if "$ref" in p else p for p in raw]


def example_for(p):
    sch = p.get("schema", {}) or {}
    if "example" in p:
        return str(p["example"])
    if "default" in sch:
        return str(sch["default"])
    if sch.get("enum"):
        return str(sch["enum"][0])
    return ""


def make_request(doc, prefix, path, op, note=""):
    params = op_params(doc, doc["paths"][path], op)
    segs = list(prefix)
    for s in path.strip("/").split("/"):
        segs.append(":" + s[1:-1] if s.startswith("{") and s.endswith("}") else s)

    path_vars, query = [], []
    for p in params:
        if p.get("in") == "path":
            path_vars.append({"key": p["name"], "value": example_for(p),
                              "description": (p.get("description") or "").strip()})
        elif p.get("in") == "query":
            query.append({"key": p["name"], "value": example_for(p),
                          "description": ("(required) " if p.get("required") else "")
                          + (p.get("description") or "").strip(),
                          "disabled": not p.get("required", False)})

    raw = "{{baseUrl}}/" + "/".join(segs)
    if query:
        raw += "?" + "&".join(f"{q['key']}={q['value']}" for q in query)
    url = {"raw": raw, "host": ["{{baseUrl}}"], "path": segs}
    if query:
        url["query"] = query
    if path_vars:
        url["variable"] = path_vars

    desc = (op.get("description") or "").strip()
    if note:
        desc = (desc + "\n\n" if desc else "") + note
    return {
        "name": (op.get("summary") or op.get("operationId") or path).strip(),
        "request": {"method": "GET",
                    "header": [{"key": "Accept", "value": "application/json"}],
                    "url": url, "description": desc},
        "response": [],
    }


def folder(name, items, description=""):
    f = {"name": name, "item": items}
    if description:
        f["description"] = description
    return f


def first_tag(op):
    return (op.get("tags") or ["General"])[0]


def build():
    docs = {k: fetch(v) for k, v in SPECS.items()}
    official, mirror, v1, v2 = (docs["core_official"], docs["core_mirror"],
                                docs["cosmos_v1"], docs["cosmos_v2"])

    by_tag: "OrderedDict[str, list]" = OrderedDict()
    for path in sorted(official["paths"]):
        op = official["paths"][path].get("get")
        if op:
            by_tag.setdefault(first_tag(op), []).append(make_request(official, [], path, op))
    mirror_extra = 0
    for path in sorted(mirror["paths"]):
        if path in official["paths"]:
            continue
        op = mirror["paths"][path].get("get")
        if op:
            by_tag.setdefault(first_tag(op), []).append(
                make_request(mirror, [], path, op, note=MIRROR_NOTE))
            mirror_extra += 1
    core_subfolders = [folder(t, items) for t, items in sorted(by_tag.items())]

    def split_bc(doc, prefix):
        bc, spec = [], []
        for path in sorted(doc["paths"]):
            op = doc["paths"][path].get("get")
            if not op:
                continue
            req = make_request(doc, prefix, path, op)
            (bc if "/bc/" in path or path.endswith("/bc") else spec).append(req)
        return bc, spec

    v1_bc, v1_spec = split_bc(v1, ["cosmos", "v1"])
    v2_bc, v2_spec = split_bc(v2, ["cosmos", "v2"])

    collection = {
        "info": {
            "name": "CDISC Library API (full)",
            "description": (
                "Every GET endpoint across CDISC's published OpenAPI specs.\n\n"
                "`baseUrl` includes /api (default https://library.cdisc.org/api).\n"
                "1. CDISC Library API (core)  - {{baseUrl}}/mdr/... (official 1.1.0 + flagged "
                "mirror extras), sub-foldered by tag.\n"
                "2. COSMoS v1                 - {{baseUrl}}/cosmos/v1/mdr/...\n"
                "3. COSMoS v2 Biomedical Concept     - {{baseUrl}}/cosmos/v2/mdr/...\n"
                "4. COSMoS v2 Dataset Specialization - {{baseUrl}}/cosmos/v2/mdr/...\n\n"
                "ENVIRONMENTS: import an environment and pick it (top-right in Postman).\n"
                "  - Production: baseUrl=https://library.cdisc.org/api + your cdisc_api_key.\n"
                "  - SwaggerHub mock: baseUrl=https://virtserver.swaggerhub.com/CDISC1/share-2.0/"
                "1.1.0 (returns example payloads, no key needed; covers the core folder only - "
                "the COSMoS folders are not mocked).\n\n"
                "AUTH: set the `cdisc_api_key` variable (from the environment); sent as the "
                "`api-key` header on every request."
            ),
            "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        "auth": {"type": "apikey", "apikey": [
            {"key": "key", "value": "api-key", "type": "string"},
            {"key": "value", "value": "{{cdisc_api_key}}", "type": "string"},
            {"key": "in", "value": "header", "type": "string"}]},
        "variable": [
            {"key": "baseUrl", "value": HOST, "type": "string"},
            {"key": "cdisc_api_key", "value": "", "type": "string"}],
        "item": [
            folder("1. CDISC Library API (core)", core_subfolders,
                   "Core CDISC Library API. URLs: {{baseUrl}}/mdr/..."),
            folder("2. COSMoS v1 (BC + SDTM Dataset Specialization)", [
                folder("Biomedical Concept (v1)", v1_bc),
                folder("SDTM Dataset Specialization (v1)", v1_spec)],
                   "URLs: {{baseUrl}}/cosmos/v1/mdr/..."),
            folder("3. COSMoS v2 - Biomedical Concept", v2_bc, "URLs: {{baseUrl}}/cosmos/v2/mdr/..."),
            folder("4. COSMoS v2 - Dataset Specialization", v2_spec,
                   "URLs: {{baseUrl}}/cosmos/v2/mdr/..."),
        ],
    }
    OUT.write_text(json.dumps(collection, indent=2), encoding="utf-8")
    total = sum(len(v) for v in by_tag.values()) + len(v1_bc) + len(v1_spec) + len(v2_bc) + len(v2_spec)
    print(f"wrote {OUT}")
    print(f"core: {sum(len(v) for v in by_tag.values())} GETs "
          f"({mirror_extra} mirror-only) | cosmos v1: {len(v1_bc)+len(v1_spec)} | "
          f"cosmos v2: BC {len(v2_bc)} + spec {len(v2_spec)}")
    print(f"TOTAL GET requests: {total}")


if __name__ == "__main__":
    build()
