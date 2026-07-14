---
name: match-bc
description: "Match each USDM activity/assessment to a CDISC Biomedical Concept (BC). Use this skill for Stage 3 of the protocol-to-synthetic-SDTM pipeline: when 01_usdm/usdm.json exists and you need 02_bc_matches.json. Deterministically retrieve candidate BCs from the CDISC Library (keyword / NCIt search via the cdisclib MCP server), then use the LLM ONLY to select the best-matching BC from the retrieved candidate set and assign a confidence score. The LLM never invents a BC id — it only chooses from candidates. Unmatched activities are flagged, not dropped. Triggers: 'match biomedical concepts', 'BC matching', 'Stage 3', 'map activities to BCs', 'find biomedical concept for activity'."
---

# Match Biomedical Concepts (Stage 3 — AI, bounded)

## Purpose

Link every USDM activity/assessment to a CDISC Biomedical Concept, so Stage 4 can resolve the
BC's SDTM Dataset Specialization (the "datasets needed" answer + the constraint set for
synthetic population). Retrieval is deterministic; only the final *selection* is LLM-driven.

## Inputs

- `01_usdm/usdm.json` (+ `01_usdm/soa.json`) — activities/assessments with `ncit_hint` and
  `sdtm_domain` from Stage 2.
- The `cdisclib` MCP server (`search`, `list_biomedical_concepts`, `get_biomedical_concept`,
  `list_bc_categories`) — needs `CDISC_API_KEY` (wired in the workflow step).

## Workflow

### Step 1 — Retrieve candidates deterministically (no LLM judgement)

For each activity, build a candidate BC set from the CDISC Library:

1. If the activity has an `ncit_hint` (a C-code), call `get_biomedical_concept(<code>)` and
   include it as a strong candidate.
2. Call `search(q=<activity name + key terms>, type="biomedicalconcept")` and take the top
   results.
3. Optionally narrow with `list_biomedical_concepts` filtered by the activity's
   `sdtm_domain` category.

Collect candidates as `{bc_id, bc_label, ncit_code, category}`. Deduplicate by `bc_id`.

### Step 2 — Select the best match (LLM, constrained)

Give the LLM the activity and ONLY the retrieved candidate set. It must:

- Choose the single best-matching `bc_id` **from the candidate list** (constrained
  generation — selecting an id that is not in the candidate set is invalid output).
- Assign `confidence` in [0, 1].
- Set `method: "llm_select_from_candidates"`.

If the candidate set is empty, do not call the LLM: mark the activity `status: "unmatched"`
and exclude its domain (logged). Never fabricate a BC id.

### Step 3 — Validate the selection

Check membership: the chosen `bc_id` MUST appear in that activity's `candidates[]`. On a
membership failure, retry with the error appended (up to `LLM_MAX_RETRIES`), then escalate to
the human checkpoint.

### Step 4 — Emit outputs + HITL review file

Write `02_bc_matches.json` (contract below) and `02_bc_matches.review.json` listing every
match with its confidence, surfacing low-confidence matches and unmatched activities for the
human at the `review-bc-matches` checkpoint.

## Output contract

`02_bc_matches.json`:

```json
{
  "study_id": "NCT04556760",
  "matches": [
    {
      "activity_id": "ACT_VS",
      "activity_label": "Vital signs",
      "bc_id": "C49680",
      "bc_label": "Systolic Blood Pressure",
      "confidence": 0.93,
      "method": "llm_select_from_candidates",
      "candidates": ["C49680", "C25298"],
      "status": "matched"
    }
  ],
  "unmatched": ["ACT_SOME_ACTIVITY"]
}
```

## Principles

- **Retrieve deterministically, select with the LLM**: the model picks from a fixed
  candidate set; it never generates a BC id.
- **Flag, don't drop**: unmatched activities are recorded with `status: "unmatched"`, not
  silently removed.
- **Surface uncertainty**: every match carries a confidence; low-confidence ones are routed
  to the human checkpoint.
- **Constrained output**: return JSON against the contract only.
