# Study Design JSON Schema

This document defines the output schema for the `extract-study-design` skill. The
`draft-sap` and `build-traceability` skills depend on this schema as their input
contract — changes here must be coordinated with those skills.

The schema is intentionally **compatible** with the `protocol-to-tfl`
trial-metadata contract (`apps/protocol-to-tfl/.../trial-metadata-extractor/references/output-schema.md`),
so a study-design record produced here can also feed the downstream TLG pipeline.
The SAP-specific addition is the `analysis_requirements` block and the
`_sap_decision` convention.

## Schema conventions

- Fields marked **(required)** must always be present (use `null` if unknown).
- Fields marked **(optional)** may be omitted entirely.
- Any field can carry sibling annotations:
  - `"_notes"` — human-readable commentary.
  - `"_source"` — which protocol section the value came from.
  - `"_reviewer_attention"` — flags an interpretation needing human verification.
  - `"_sap_decision"` — flags an analysis choice the protocol does not make that
    the `draft-sap` skill must specify and surface to the reviewer.

## Complete schema

```json
{
  "schema_version": "1.0",
  "extraction_date": "YYYY-MM-DD",
  "source_documents": [
    {
      "type": "protocol | protocol_amendment | annotated_crf | sap_template | conventions | other",
      "filename": "string",
      "version": "string or null",
      "date": "YYYY-MM-DD or null"
    }
  ],

  "study_identification": {
    "study_id": "string (required) — Protocol number / study ID",
    "study_title": "string (required) — Full title from the protocol",
    "short_title": "string (optional)",
    "sponsor": "string (required)",
    "phase": "Phase I | Phase I/II | Phase II | Phase II/III | Phase III | Phase IV | NA",
    "indication": "string (required) — Primary disease/condition",
    "therapeutic_area": "Oncology | CNS | Cardiovascular | Immunology | Infectious Disease | Metabolic | Respiratory | Rare Disease | Dermatology | Ophthalmology | Other",
    "compound_name": "string — Drug/biologic name",
    "compound_class": "string (optional)",
    "registration_id": "string or null — e.g., NCT number"
  },

  "study_design": {
    "type": "string (required) — e.g., 'randomized, double-blind, placebo-controlled, parallel-group'",
    "randomized": "boolean",
    "blinding": "open-label | single-blind | double-blind | triple-blind",
    "control_type": "placebo | active | dose-comparison | historical | none | null",
    "allocation_ratio": "string or null — e.g., '1:1', '2:1'",
    "stratification_factors": ["string — randomization stratification factors, if any"],
    "adaptive": "boolean",
    "adaptive_details": "string or null",
    "cohorts": "optional — array of cohort objects for basket/umbrella designs, each mirroring treatment_arms",

    "treatment_arms": [
      {
        "arm_id": "string — e.g., 'TRT1', 'PBO'",
        "arm_name": "string — e.g., 'Drug X 200mg QD'",
        "arm_type": "experimental | active_comparator | placebo | sham | no_intervention",
        "dose": "string or null",
        "route": "string or null",
        "regimen": "string or null",
        "planned_n": "integer or null"
      }
    ]
  },

  "objectives": [
    {
      "objective_id": "string — e.g., 'OBJ-PRI-1'",
      "type": "primary | secondary | exploratory | safety",
      "text": "string (required) — exact objective wording from the protocol",
      "endpoint_ids": ["string — ids of endpoints that address this objective"]
    }
  ],

  "endpoints": {
    "primary": [
      {
        "endpoint_id": "string — e.g., 'EP-PRI-1'",
        "name": "string (required) — e.g., 'Overall Survival'",
        "definition": "string (required) — exact protocol definition; preserve wording",
        "type": "time-to-event | continuous | binary | categorical | count | rate | ordinal",
        "timing": "string or null — e.g., 'from randomization to death from any cause'",
        "_sap_decision": "optional — analysis choices the SAP must specify"
      }
    ],
    "secondary": ["same shape as primary"],
    "exploratory": ["same shape as primary"],
    "safety": ["same shape as primary — e.g., AEs, labs, vitals, ECG"]
  },

  "populations": [
    {
      "population_id": "string — e.g., 'ITT', 'SAF', 'PP'",
      "name": "string — e.g., 'Intent-to-Treat'",
      "definition": "string (required) — exact criteria; preserve protocol wording",
      "primary_for": ["analysis category this population is primary for — e.g., 'efficacy', 'safety'"]
    }
  ],

  "analysis_requirements": [
    {
      "requirement_id": "string — e.g., 'AR-PRI-1'",
      "endpoint_id": "string — endpoint this analysis serves",
      "population_id": "string — analysis population",
      "purpose": "primary | secondary | sensitivity | subgroup | safety | exploratory",
      "method": "string or null — statistical method named in the protocol (e.g., 'stratified log-rank', 'MMRM'); null when the protocol is silent",
      "comparison": "string or null — e.g., 'experimental vs placebo'",
      "covariates": ["string — adjustment covariates, if specified"],
      "hypothesis": "string or null — null/superiority/non-inferiority/equivalence + margin",
      "_sap_decision": "optional — when method is null, the decision the SAP must make and flag",
      "_source": "protocol section reference"
    }
  ],

  "visit_schedule": [
    {
      "visit_id": "string — e.g., 'V1', 'SCREEN', 'EOT'",
      "name": "string — e.g., 'Cycle 1 Day 1'",
      "nominal_day": "integer or null",
      "window": "string or null — e.g., '±3 days'"
    }
  ],

  "baseline_definition": "string or null — how baseline is defined (e.g., 'last non-missing value prior to first dose')",

  "missing_data": {
    "approach": "string or null — protocol-stated handling, if any",
    "estimand_framework": "boolean or null — whether an ICH E9(R1) estimand framework is referenced",
    "_sap_decision": "optional — imputation / estimand decisions the SAP must make"
  },

  "multiplicity": {
    "approach": "string or null — protocol-stated multiplicity control, if any",
    "_sap_decision": "optional — testing strategy the SAP must specify"
  },

  "sample_size": {
    "planned_total": "integer or null",
    "per_arm": "object or null — planned_n per arm_id",
    "power": "number or null — e.g., 0.9",
    "alpha": "number or null — e.g., 0.025 one-sided",
    "assumptions": "string or null — effect size / variability assumptions",
    "method": "string or null — sample size calculation method"
  },

  "interim_analyses": [
    {
      "interim_id": "string",
      "timing": "string — e.g., 'after 60% of target events'",
      "purpose": "string — efficacy | futility | safety",
      "alpha_spending": "string or null"
    }
  ],

  "validation_summary": {
    "fields_missing": ["string — schema fields that could not be populated"],
    "inconsistencies": ["string — endpoint/population/arm mismatches found"],
    "sap_decisions": ["string — list of every _sap_decision the drafting step must resolve"],
    "recommendations": ["string — what the user should supplement before drafting"]
  }
}
```

## Notes on key fields

- **`objectives` ↔ `endpoints` ↔ `analysis_requirements`** form the traceability
  spine. Keep the `*_id` cross-references consistent — `build-traceability`
  walks them to construct the matrix and the ARS analysis metadata.
- **`analysis_requirements.method = null` + `_sap_decision`** is the explicit
  hand-off: it tells `draft-sap` exactly which method choices it must make and
  flag for the biostatistician, which is how the pipeline stays honest about
  what came from the protocol versus what the SAP introduced.
