---
name: build-traceability
description: "Build the traceability artifacts that prove a generated SAP is consistent with and traceable to the study design. Use this skill as the third step of SAP generation, after draft-sap has produced sap-draft.md. It harvests the [trace: ...] tags from the SAP, cross-checks them against study-design.json, and emits traceability-matrix.json (design element -> endpoint -> analysis -> SAP section -> planned display) plus an ARS-aligned analysis-metadata.json modeled on the CDISC Analysis Results Standard. Trigger on 'build the traceability matrix', 'check SAP traceability', 'generate ARS metadata', or 'link analyses to study design'."
---

# Build Traceability

## Purpose

Produce the **traceability and consistency** artifacts that make a generated SAP
defensible for the CDISC challenge's "accurate, consistent, and traceable to
study design" criterion:

1. `outputs/traceability-matrix.json` — a row per planned analysis linking
   **objective → endpoint → analysis requirement → population → SAP section →
   planned display**.
2. `outputs/analysis-metadata.json` — the same analyses expressed in a pragmatic
   subset of the **CDISC Analysis Results Standard (ARS)** object model, so the
   plan is machine-checkable and can be consumed by the downstream
   `protocol-to-tfl` pipeline.

This step does not author prose — it validates and structures what `draft-sap`
produced.

## When to use

- After `draft-sap` produced `outputs/sap-draft.md` and
  `outputs/study-design.json` exists.
- Whenever the user asks to verify SAP↔design traceability or to emit ARS
  analysis metadata.

## Workflow

### Step 1: Load inputs

1. `outputs/study-design.json` — the structured design (the source of truth for
   ids).
2. `outputs/sap-draft.md` — the drafted SAP (the source of `[trace: …]` tags and
   section numbers).
3. `references/ars-object-guide.md` — the ARS object subset and the JSON shape to
   emit. **Always read this before building `analysis-metadata.json`.**

### Step 2: Harvest and cross-check trace tags

- Scan `sap-draft.md` for every `[trace: …]` tag and the SAP section it sits in.
- For each id referenced in a tag, confirm it exists in `study-design.json`
  (objective, endpoint, population, or analysis_requirement). Record any tag id
  that does not resolve as a `dangling_trace` error.
- For each primary and secondary endpoint in `study-design.json`, confirm at
  least one SAP analysis traces to it. Record any endpoint with no analysis as a
  `missing_analysis` gap.
- For each `_sap_decision` in `study-design.json`, confirm it appears in the
  SAP's §15 deviations ledger (Changes from protocol). Record misses as
  `undocumented_decision`.

### Step 3: Emit the traceability matrix

Write `outputs/traceability-matrix.json`:

```json
{
  "schema_version": "1.0",
  "study_id": "string — from study_identification.study_id",
  "rows": [
    {
      "objective_id": "string",
      "endpoint_id": "string",
      "analysis_requirement_id": "string",
      "population_id": "string",
      "sap_section": "string — e.g., '8.1'",
      "method": "string — as specified in the SAP",
      "is_sap_decision": "boolean — true if the method was introduced by the SAP, not the protocol",
      "planned_display": "string — TLG title/number from SAP §15, or null"
    }
  ],
  "coverage": {
    "primary_endpoints_total": "integer",
    "primary_endpoints_traced": "integer",
    "secondary_endpoints_total": "integer",
    "secondary_endpoints_traced": "integer"
  },
  "issues": {
    "dangling_trace": ["trace ids in the SAP that do not resolve to study-design.json"],
    "missing_analysis": ["endpoint ids with no traced analysis"],
    "undocumented_decision": ["_sap_decision items missing from SAP §14"]
  }
}
```

### Step 4: Emit ARS-aligned analysis metadata

Following `references/ars-object-guide.md`, write `outputs/analysis-metadata.json`
expressing each planned analysis as an ARS `Analysis` referencing an
`AnalysisMethod` (which bundles ordered `Operation`s), an `AnalysisSet`
(population, via a `whereClause`), optional `DataSubset`s and ordered
`GroupingFactor`s (e.g. treatment arm), the `Output → OutputDisplay` it produces,
all wrapped in a single `ReportingEvent`. For each analysis also record the
**ADaM target dataset** it implies (`adamTarget`: ADSL / ADTTE for OS/PFS/DOR /
ADRS for response / ADAE for AEs) so the metadata bridges to the downstream
`protocol-to-tfl` pipeline and to define.xml / ARM lineage. Keep ids consistent
with the traceability matrix and `study-design.json` so the three files
cross-reference cleanly.

### Step 5: Report

Present a concise summary:

- Coverage: primary/secondary endpoints traced vs total (aim for 100%).
- Count of analyses emitted and SAP DECISIONs among them.
- Any `issues` found — `dangling_trace`, `missing_analysis`, and
  `undocumented_decision` are blockers the reviewer must see. If issues are
  non-empty, recommend sending the SAP back to `draft-sap` (the `revise`
  verdict) rather than approving.

## Notes

- This skill is read-and-structure only; if it finds gaps, surface them — do not
  patch the SAP prose here. Fixing belongs in `draft-sap` on a revise pass.
- The ARS subset is pragmatic (not the full normative model) but uses ARS object
  names and relationships so the output is recognizable to anyone working with
  CDISC ARS and consumable downstream.

## Reference files

- `references/ars-object-guide.md` — the ARS object subset, relationships, ADaM
  target mapping, and the exact JSON shape for `analysis-metadata.json`. **Always
  read before emitting ARS metadata.**
- `references/protocol-to-sap-playbook.md` — context on why ARS/ADaM traceability
  is the differentiator and how analyses map to ADaM datasets.
