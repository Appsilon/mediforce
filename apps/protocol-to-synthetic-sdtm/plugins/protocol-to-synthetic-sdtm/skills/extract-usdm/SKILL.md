---
name: extract-usdm
description: "Build a USDM v3.0 study representation from a ClinicalTrials.gov record (Stage 1 output) and, when present, the protocol PDF Schedule of Activities. Use this skill for Stage 2 of the protocol-to-synthetic-SDTM pipeline: when 00_raw/<NCT>.json exists and you need 01_usdm/usdm.json + soa.json. Deterministically maps the structured, enumerated CT.gov fields (arms, interventions, eligibility flags, phase, design) and uses the LLM ONLY for the free-text fragments that have no clean schema field — parsing eligibility criteria into discrete criterion objects, normalising objectives/endpoints, and reading the protocol Schedule of Activities into a visit grid + activity list. Triggers: 'extract USDM', 'build USDM', 'Stage 2', 'USDM from study record', 'SoA extraction'."
---

# Extract to USDM (Stage 2 — AI, bounded)

## Purpose

Produce a USDM v3.0-conformant study representation that downstream deterministic stages
consume. The split is deliberate (spec §1.1 deterministic-first): structured fields are
mapped by code; the LLM only structures free text and the protocol Schedule of Activities.

## Inputs

- `00_raw/<NCT>.json` — verbatim CT.gov API v2 record (Stage 1).
- `protocol/*.pdf` (+ `.txt`) — protocol / SAP documents, when the study registered them.
- The `ctgov` MCP server is available (`get_study`, `get_enums`, `get_field_values`,
  `list_study_documents`) to re-query structured fields/enums while assembling the document.

## Workflow

### Step 1 — Map the structured fields deterministically (no LLM)

From `protocolSection`, copy enumerated/structured content straight through:

- `identificationModule` → study id, NCT id, title.
- `designModule` → phase, study type, allocation, masking, model, `enrollmentInfo`.
- `armsInterventionsModule` → arms and interventions (1:1, no inference).
- `eligibilityModule` flags → `sex`, `minimumAge`, `maximumAge`, `healthyVolunteers`.
- `conditionsModule` → conditions.

These become USDM `StudyDesign`, `StudyArm`, `StudyIntervention`, `StudyEpoch`, and
`Population` objects. Do **not** ask the LLM to restate anything already enumerated here.

### Step 2 — Structure the free text (LLM, constrained)

Use the LLM only where the registry stores prose:

1. **Eligibility criteria** — split `eligibilityModule.eligibilityCriteria` into discrete
   inclusion/exclusion `EligibilityCriterion` objects (one rule each, original wording
   preserved, `category: inclusion|exclusion`).
2. **Objectives / endpoints** — normalise `outcomesModule` primary/secondary outcomes into
   USDM `Objective` + `Endpoint` pairs.

The LLM returns JSON against the fixed USDM-fragment schema only — no prose, no invented ids.

### Step 3 — Extract the Schedule of Activities (LLM, from the protocol PDF)

If a protocol PDF is present, read its Schedule of Activities table and produce, into
`soa.json`:

- `encounters[]` — visit grid: `{id, name, label, epoch, timing}`.
- `epochs[]` — `{id, name, type}` (SCREENING / TREATMENT / WASHOUT / FOLLOW_UP / ...).
- `activities[]` — `{id, name, encounters[], cdash_domain, ncit_hint, source_page}`.

Every activity MUST carry provenance: the protocol page it came from. `cdash_domain` is the
data-collection target the activity feeds (e.g. VS, LB, AE) — this is the handle Stage 3
(match-bc) keys on. Use `ncit_hint` only when an NCIt concept applies cleanly; never guess.

If no protocol PDF is present, infer a minimal activity list from the outcome measures
instead, and mark each activity `source: "outcome_measure_inference"`.

### Step 4 — Assemble + validate

Assemble the USDM v3.0 document (DDF class names) into `01_usdm/usdm.json`. Validate against
the USDM v3.0 schema. On failure, retry with the validation error appended (up to
`LLM_MAX_RETRIES`); if it still fails, stop and escalate to the human checkpoint.

### Step 5 — Emit the HITL review file

Write `01_usdm.review.json` summarising **what was inferred by the LLM vs. directly mapped**:
per object, `{id, type, source: "ct_structured" | "llm_freetext" | "protocol_soa", confidence}`.
This is what the human reviews at the `review-usdm` checkpoint.

## Output contract

```
01_usdm/usdm.json          USDM v3.0 study document (must pass schema validation)
01_usdm/soa.json           extracted Schedule of Activities (encounters x activities)
01_usdm.review.json        inferred-vs-mapped summary for the HITL checkpoint
```

## Principles

- **Deterministic-first**: if a field is enumerated in the CT.gov record, map it in code —
  the LLM never restates structured data.
- **No invented ids or values**: preserve source wording for criteria/endpoints; flag
  ambiguity with `_notes` rather than guessing.
- **Provenance everywhere**: every activity records its protocol page or inference source so
  Stage 4/5 can trace a synthetic cell back to the originating document.
- **Constrained output**: return JSON against the fixed schema only.
