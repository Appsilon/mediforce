# Trial Metadata JSON Schema

This document defines the complete output schema for the trial metadata extractor. Every field is documented with its purpose, expected values, and which downstream process consumes it.

The `mock-tlg-generator` skill depends on this schema as its input contract. Changes here must be coordinated with that skill.

## Schema conventions

- Fields marked **(required)** must always be present (use `null` if unknown)
- Fields marked **(optional)** may be omitted entirely
- Any field can have a sibling `"_notes"` field for human-readable commentary
- Any field can have a sibling `"_reviewer_attention"` field flagging items needing human review
- Any field can have a `"_source"` field indicating which document section it came from

## Complete schema

```json
{
  "schema_version": "1.0",
  "extraction_date": "YYYY-MM-DD",
  "source_documents": [
    {
      "type": "protocol | sap | protocol_amendment | other",
      "filename": "string",
      "version": "string or null",
      "date": "YYYY-MM-DD or null"
    }
  ],

  "study_identification": {
    "study_id": "string (required) — Protocol number / study ID",
    "study_title": "string (required) — Full title from the protocol",
    "short_title": "string (optional) — Abbreviated title if available",
    "sponsor": "string (required)",
    "phase": "Phase I | Phase I/II | Phase II | Phase IIa | Phase IIb | Phase II/III | Phase III | Phase IIIb | Phase IV | NA",
    "indication": "string (required) — Primary disease/condition",
    "therapeutic_area": "Oncology | CNS | Cardiovascular | Immunology | Infectious Disease | Metabolic | Respiratory | Rare Disease | Dermatology | Ophthalmology | Other",
    "compound_name": "string — Drug/biologic name",
    "compound_class": "string (optional) — e.g., 'monoclonal antibody', 'small molecule', 'ADC', 'CAR-T'",
    "regulatory_status": "IND | NDA | BLA | sNDA | sBLA | other | null"
  },

  "study_design": {
    "type": "string (required) — e.g., 'randomized, double-blind, placebo-controlled, parallel-group'",
    "randomized": "boolean",
    "blinding": "open-label | single-blind | double-blind | triple-blind",
    "control_type": "placebo | active | dose-comparison | historical | none | null",
    "adaptive": "boolean — Whether the design includes adaptive elements",
    "adaptive_details": "string or null — Description of adaptive features if applicable",

    "treatment_arms": [
      {
        "arm_id": "string — Short identifier (e.g., 'TRT1', 'PBO')",
        "arm_name": "string — Full name (e.g., 'Drug X 200mg QD')",
        "arm_type": "experimental | active_comparator | placebo | sham | no_intervention",
        "dose": "string or null",
        "route": "string or null — e.g., 'oral', 'IV', 'SC'",
        "regimen": "string or null — Dosing schedule description",
        "planned_n": "integer or null — Planned number of subjects"
      }
    ],
    "total_planned_n": "integer or null",
    "randomization_ratio": "string or null — e.g., '2:1', '1:1:1'",
    "stratification_factors": ["string — Each stratification factor"],

    "study_periods": [
      {
        "period_name": "string — e.g., 'Screening', 'Run-in', 'Treatment', 'Follow-up'",
        "duration": "string — e.g., '28 days', '24 weeks'",
        "description": "string or null"
      }
    ],

    "cohorts": "array or null — For basket/umbrella/platform designs, each cohort as a nested design object"
  },

  "populations": {
    "intent_to_treat": {
      "abbreviation": "ITT",
      "definition": "string (required) — Exact definition from SAP/Protocol",
      "is_primary_efficacy_population": "boolean"
    },
    "modified_itt": {
      "abbreviation": "mITT",
      "definition": "string or null",
      "is_primary_efficacy_population": "boolean"
    },
    "per_protocol": {
      "abbreviation": "PP",
      "definition": "string or null",
      "is_primary_efficacy_population": "boolean"
    },
    "safety": {
      "abbreviation": "SAF",
      "definition": "string (required) — Typically all subjects who received at least one dose",
      "is_primary_safety_population": "boolean"
    },
    "pk_population": {
      "abbreviation": "PK",
      "definition": "string or null"
    },
    "other_populations": [
      {
        "name": "string",
        "abbreviation": "string",
        "definition": "string",
        "purpose": "string — What analyses use this population"
      }
    ]
  },

  "endpoints": {
    "primary": [
      {
        "endpoint_id": "PE01",
        "name": "string (required) — Short name",
        "description": "string (required) — Full definition from Protocol/SAP",
        "type": "efficacy | safety | pharmacokinetic | biomarker | PRO | other",
        "measurement": "string — What is measured and how",
        "timepoint": "string — When the primary assessment occurs",
        "variable_type": "continuous | binary | categorical | time-to-event | count | ordinal",
        "direction_of_benefit": "higher_is_better | lower_is_better | null",
        "clinically_meaningful_difference": "string or null — The targeted effect size if stated",
        "related_adam_dataset": "string or null — e.g., 'ADTTE', 'ADEFF', 'ADLB'"
      }
    ],
    "secondary": [
      {
        "endpoint_id": "SE01",
        "name": "string",
        "description": "string",
        "type": "string",
        "measurement": "string",
        "timepoint": "string or null",
        "variable_type": "string",
        "related_adam_dataset": "string or null"
      }
    ],
    "exploratory": [
      {
        "endpoint_id": "EE01",
        "name": "string",
        "description": "string",
        "type": "string",
        "variable_type": "string or null"
      }
    ],
    "safety_endpoints": [
      {
        "endpoint_id": "SAF01",
        "name": "string — e.g., 'Treatment-emergent adverse events'",
        "description": "string",
        "type": "string — e.g., 'AE incidence', 'lab shift', 'vital signs', 'ECG'"
      }
    ]
  },

  "statistical_analyses": {
    "primary_analysis": [
      {
        "analysis_id": "PA01",
        "endpoint_id": "PE01 — Reference to the endpoint being analyzed",
        "description": "string — Full description of the analysis",
        "population": "string — Which population (e.g., 'ITT')",
        "statistical_method": "string (required) — e.g., 'MMRM', 'Logistic regression', 'Cox PH model', 'ANCOVA', 'CMH test', 'Kaplan-Meier'",
        "model_details": {
          "response_variable": "string",
          "covariates": ["string"],
          "factors": ["string"],
          "interaction_terms": ["string or null"],
          "other_details": "string or null"
        },
        "hypothesis": {
          "null_hypothesis": "string or null",
          "alternative": "one-sided | two-sided",
          "alpha": "number — e.g., 0.05",
          "alpha_adjustment": "string or null — e.g., 'Bonferroni', 'Hochberg', 'gatekeeping'"
        },
        "multiplicity_strategy": "string or null — How Type I error is controlled across primary endpoints",
        "sensitivity_analyses": [
          {
            "name": "string",
            "description": "string",
            "method": "string"
          }
        ]
      }
    ],
    "secondary_analyses": [
      {
        "analysis_id": "SA01",
        "endpoint_id": "SE01",
        "description": "string",
        "population": "string",
        "statistical_method": "string",
        "multiplicity_handling": "string or null"
      }
    ],
    "subgroup_analyses": [
      {
        "subgroup_variable": "string — e.g., 'Age group (<65 / ≥65)', 'Sex', 'Region'",
        "endpoints_analyzed": ["string — endpoint_ids"],
        "method": "string or null — e.g., 'Forest plot of treatment effects', 'Interaction test'"
      }
    ],
    "interim_analyses": [
      {
        "timing": "string — e.g., 'After 50% of events', 'After 100 subjects enrolled'",
        "purpose": "futility | efficacy | both | safety",
        "spending_function": "string or null — e.g., 'O'Brien-Fleming', 'Lan-DeMets'",
        "stopping_rules": "string or null"
      }
    ]
  },

  "missing_data": {
    "primary_strategy": "string — e.g., 'MMRM (implicit MAR assumption)'",
    "imputation_methods": [
      {
        "method_name": "string — e.g., 'LOCF', 'WOCF', 'BOCF', 'Multiple imputation', 'Tipping point'",
        "applied_to": "string — Which endpoints or analyses",
        "is_primary_or_sensitivity": "primary | sensitivity",
        "details": "string or null"
      }
    ],
    "estimand_framework": {
      "used": "boolean",
      "intercurrent_events": [
        {
          "event": "string — e.g., 'Treatment discontinuation', 'Use of rescue medication'",
          "strategy": "treatment_policy | hypothetical | composite | while_on_treatment | principal_stratum"
        }
      ]
    }
  },

  "baseline_definition": {
    "general_rule": "string (required) — e.g., 'Last non-missing value on or before first dose date'",
    "exceptions": [
      {
        "domain": "string — e.g., 'Vital Signs', 'ECG'",
        "rule": "string — e.g., 'Average of screening and Day 1 pre-dose values'"
      }
    ]
  },

  "visit_schedule": {
    "visits": [
      {
        "visit_name": "string — e.g., 'Screening', 'Baseline/Day 1', 'Week 4'",
        "visit_number": "integer or null",
        "target_day": "integer or null — Study day relative to first dose",
        "window_lower": "integer or null — Days before target",
        "window_upper": "integer or null — Days after target",
        "assessments": ["string — Key assessments at this visit"]
      }
    ],
    "windowing_rules": "string or null — General rules for visit windowing in analysis"
  },

  "sample_size": {
    "total_planned": "integer or null",
    "per_arm": "object or null — arm_id: integer pairs",
    "power": "number or null — e.g., 0.9",
    "alpha": "number or null — e.g., 0.05 (two-sided)",
    "assumptions": "string or null — Key assumptions driving sample size",
    "dropout_rate_assumed": "number or null — e.g., 0.15 for 15%",
    "method": "string or null — e.g., 'Log-rank test', 'Two-sample t-test'"
  },

  "planned_tlg_list": {
    "_notes": "This section captures any explicit TLG listing from the SAP. If the SAP does not include a list, leave as null and the mock-tlg-generator will derive the list from the analyses above.",
    "tables": [
      {
        "tlg_id": "T-14.1.1",
        "title": "string",
        "population": "string",
        "description": "string or null"
      }
    ],
    "listings": [
      {
        "tlg_id": "L-16.1.1",
        "title": "string",
        "population": "string",
        "description": "string or null"
      }
    ],
    "figures": [
      {
        "tlg_id": "F-14.1.1",
        "title": "string",
        "population": "string",
        "description": "string or null"
      }
    ]
  },

  "validation_summary": {
    "completeness_score": "string — e.g., 'High / Medium / Low'",
    "fields_missing": ["string — List of important fields that could not be extracted"],
    "inconsistencies_found": ["string — Any discrepancies between Protocol and SAP or within a document"],
    "reviewer_attention_items": ["string — Items flagged for human review"],
    "recommendations": ["string — Suggestions for the user before proceeding to TLG generation"]
  }
}
```

## Field guidance for common scenarios

### Phase I dose-escalation trials
- `study_design.type` often includes "open-label, dose-escalation"
- `treatment_arms` may be sequential cohorts rather than parallel arms — use `cohorts` for this
- Primary endpoints are typically safety/tolerability and PK — set `endpoints.primary[].type` to `"safety"` or `"pharmacokinetic"`
- DLT (dose-limiting toxicity) definitions should go in `endpoints.safety_endpoints` with detailed criteria in `description`
- Planned TLGs are typically fewer: PK parameter summaries, AE tables, DLT listings

### Phase II proof-of-concept
- May have both efficacy and safety as co-primary endpoints
- Look for futility/efficacy interim analyses — these are common
- Subgroup analyses may be more exploratory
- Response rate (ORR) in oncology uses specific RECIST criteria — capture the version in the endpoint description

### Phase III confirmatory trials
- Most complex TLG packages (often 50-200+ shells)
- Multiplicity adjustment across primary/secondary endpoints is critical — capture the full testing hierarchy
- Estimand framework (ICH E9(R1)) is increasingly required — check for intercurrent event strategies
- Subgroup analyses are usually pre-specified and regulatory-relevant

### Oncology-specific
- Time-to-event endpoints (OS, PFS, DFS) → note the event definitions carefully
- RECIST/iRECIST criteria version for response endpoints
- Biomarker-defined subpopulations (e.g., PD-L1 status, HER2 status)
- Common endpoints: ORR, DCR, DOR, TTR, OS, PFS, EFS

### CNS-specific
- Rating scales (MADRS, HAM-D, PANSS, ADAS-Cog, CDR-SB) → capture which version
- MMRM is the most common primary analysis method
- Missing data handling is especially critical (high dropout rates)
- Common TLGs include responder analyses at various thresholds

### Cardiovascular
- MACE (Major Adverse Cardiovascular Events) as composite endpoint — list components
- Adjudication committee processes may affect endpoint definitions
- Time-to-first-event analyses (similar to oncology TTE)
- Common: Kaplan-Meier curves, Forest plots by subgroup, waterfall plots for biomarkers
