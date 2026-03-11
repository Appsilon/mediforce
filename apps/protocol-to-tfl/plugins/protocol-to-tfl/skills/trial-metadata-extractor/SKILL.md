---
name: trial-metadata-extractor
description: "Extract structured metadata from clinical trial Protocol and Statistical Analysis Plan (SAP) documents into a standardized JSON format. Use this skill whenever the user provides a Protocol, SAP, or both (as file paths or uploaded files) and wants to extract study design, endpoints, populations, visit schedules, analysis plans, or any structured trial metadata. Also trigger when the user mentions 'protocol review', 'SAP review', 'trial metadata', 'study design extraction', 'endpoint extraction', 'ADaM planning', 'TLG planning', or wants to prepare inputs for mock TLG shell generation. This skill is the first step in a Protocol->SAP->Metadata->TLG pipeline. Even if the user only provides one document (Protocol OR SAP), use this skill -- it handles partial inputs gracefully and flags what's missing."
---

# Trial Metadata Extractor

## Purpose

This skill reads clinical trial Protocol and/or SAP documents (PDF, DOCX, or text) and produces a structured JSON metadata file that captures everything needed to plan ADaM datasets and generate mock TLG shells downstream.

The output JSON serves as a **contract** between this extraction step and the `mock-tlg-generator` skill. It must be comprehensive enough that a biostatistician could review it and confirm it faithfully represents the trial design and statistical plan.

## HARD STOP: Output Contract

**This is a headless pipeline step. There is no human listening.**

**CRITICAL WARNING**: The output metadata JSON is very large (500+ lines). If you compose it in your head and try to output it as text, you WILL exceed the time limit and the entire run will be killed. You MUST use the Write tool to save the JSON to a file. Your final text response must be tiny.

Your ONLY output as a final message must be a raw JSON object (no markdown fences, no preamble, no explanation):

```
{"output_file": "/absolute/path/to/written/file.json", "summary": "1-2 sentence summary of what was extracted"}
```

Rules:
- **Use the Write tool** to save the metadata JSON to a file. Do NOT include the metadata JSON in your response text -- it is too large and will cause a timeout.
- Your final text response is ONLY the small contract JSON above (the one with `output_file` and `summary`). Nothing else.
- Do NOT write conversational summaries, recommendations, or next step suggestions
- Do NOT wrap anything in markdown code fences
- Do NOT continue working after writing the output file and emitting the JSON response
- **Budget your time** -- you will be told how much time you have in the input. Prioritize core extraction (study ID, design, endpoints, analyses). If running low on time, skip validation and output what you have.

## Workflow

### Step 1: Identify and read the input documents

The user will typically provide one or more of:
- PDF file paths (Protocol and/or SAP) -- read them with the Read tool (supports PDFs up to 20 pages per read; for large documents read in chunks by section)
- Files already pasted into the conversation context

Document pairing convention in this project: files in `test-docs/` are named `{NCT_ID}_Prot_*.pdf` and `{NCT_ID}_SAP_*.pdf`. Match by NCT ID.

Handle partial inputs:
- **Protocol only** -- Extract what's available, flag SAP-dependent fields as `"source": "not_available_from_protocol"`
- **SAP only** -- Extract analysis plan details, flag protocol-dependent fields similarly
- **Both** -- Full extraction, cross-reference between documents

### Step 2: Extract metadata into the standardized schema

Extract information systematically by working through each section of the schema (see "Output Schema" below). For each field:
1. Search the source document(s) for relevant sections
2. Extract the information faithfully -- do not invent or assume
3. If information is ambiguous, include a `"_notes"` field explaining the ambiguity
4. If information is absent, use `null` with a `"_notes"` explaining what's missing and where it would typically be found

**Critical principles:**
- **Fidelity over completeness**: Never fabricate information. It's better to have `null` fields with notes than wrong data.
- **Preserve source language**: For endpoint definitions, population criteria, and derivation rules, use the document's exact wording (these are regulatory-grade definitions where paraphrasing introduces risk).
- **Flag judgment calls**: If you had to interpret ambiguous text, add a `"_reviewer_attention"` field explaining what needs human verification.
- **Cross-reference**: When both Protocol and SAP are available, note discrepancies. The SAP typically takes precedence for analysis-related decisions, while the Protocol takes precedence for study design.

### Step 3: Quick consistency check

Do a fast pass over the extracted JSON to catch obvious gaps:
- Do primary/secondary endpoints have corresponding entries in `statistical_analyses`?
- Are populations referenced in analyses actually defined in `populations`?
- Are treatment arms referenced in analyses actually defined?

Add a `"validation_summary"` section noting any gaps found. Do not re-read documents for this step -- just check internal consistency of what you already extracted.

### Step 4: Write the output file

Use the **Write tool** to save the extracted metadata JSON to a file named `{NCT_ID}-trial-metadata.json` in the output directory specified in the "Output Directory" section of the input. Use the full absolute path provided there.

This is essential: call the Write tool with the complete JSON content. Do NOT try to output the JSON as text -- it is too large and will cause the process to time out before you finish generating it.

Then, as your **final message**, output ONLY the small contract JSON described in the "HARD STOP" section above:
```
{"output_file": "/absolute/path/to/file.json", "summary": "1-2 sentence summary"}
```
Nothing else.

## Handling edge cases

**Large PDFs**: Most Protocol and SAP documents exceed 20 pages. Use targeted page ranges with the Read tool -- start with the first 5 pages (title, synopsis, TOC) to orient, then read specific sections relevant to each schema field. The SAP Section Guide below lists where key information typically appears.

**Incomplete documents**: Some SAPs are posted without mock shells for disclosure. Some protocols are early drafts. Always extract what's available and clearly document gaps.

**Non-standard structure**: SAPs vary significantly between sponsors and CROs. Focus on extracting the semantic content rather than expecting specific section numbering. Common SAP sections to look for:
- Study objectives and endpoints
- Study design description
- Analysis populations
- Statistical methods (for each endpoint)
- Missing data handling / imputation rules
- Subgroup and sensitivity analyses
- Interim analyses
- List of planned tables, figures, and listings

**Multiple indications or cohorts**: Some trials (especially basket/umbrella designs) have multiple cohorts. Create nested structures under `design.cohorts` rather than flattening.

**Amendments**: If the document references protocol amendments, extract the current (amended) version of any changed elements and note the amendment in `_notes`.

---

## Output Schema

This defines the complete output schema for the trial metadata extractor. Every field is documented with its purpose, expected values, and which downstream process consumes it.

The `mock-tlg-generator` skill depends on this schema as its input contract.

### Schema conventions

- Fields marked **(required)** must always be present (use `null` if unknown)
- Fields marked **(optional)** may be omitted entirely
- Any field can have a sibling `"_notes"` field for human-readable commentary
- Any field can have a sibling `"_reviewer_attention"` field flagging items needing human review
- Any field can have a `"_source"` field indicating which document section it came from

### Complete schema

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
        "subgroup_variable": "string — e.g., 'Age group (<65 / >=65)', 'Sex', 'Region'",
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

### Field guidance for common scenarios

#### Phase I dose-escalation trials
- `study_design.type` often includes "open-label, dose-escalation"
- `treatment_arms` may be sequential cohorts rather than parallel arms -- use `cohorts` for this
- Primary endpoints are typically safety/tolerability and PK -- set `endpoints.primary[].type` to `"safety"` or `"pharmacokinetic"`
- DLT (dose-limiting toxicity) definitions should go in `endpoints.safety_endpoints` with detailed criteria in `description`
- Planned TLGs are typically fewer: PK parameter summaries, AE tables, DLT listings

#### Phase II proof-of-concept
- May have both efficacy and safety as co-primary endpoints
- Look for futility/efficacy interim analyses -- these are common
- Subgroup analyses may be more exploratory
- Response rate (ORR) in oncology uses specific RECIST criteria -- capture the version in the endpoint description

#### Phase III confirmatory trials
- Most complex TLG packages (often 50-200+ shells)
- Multiplicity adjustment across primary/secondary endpoints is critical -- capture the full testing hierarchy
- Estimand framework (ICH E9(R1)) is increasingly required -- check for intercurrent event strategies
- Subgroup analyses are usually pre-specified and regulatory-relevant

#### Oncology-specific
- Time-to-event endpoints (OS, PFS, DFS) -- note the event definitions carefully
- RECIST/iRECIST criteria version for response endpoints
- Biomarker-defined subpopulations (e.g., PD-L1 status, HER2 status)
- Common endpoints: ORR, DCR, DOR, TTR, OS, PFS, EFS

#### CNS-specific
- Rating scales (MADRS, HAM-D, PANSS, ADAS-Cog, CDR-SB) -- capture which version
- MMRM is the most common primary analysis method
- Missing data handling is especially critical (high dropout rates)
- Common TLGs include responder analyses at various thresholds

#### Cardiovascular
- MACE (Major Adverse Cardiovascular Events) as composite endpoint -- list components
- Adjudication committee processes may affect endpoint definitions
- Time-to-first-event analyses (similar to oncology TTE)
- Common: Kaplan-Meier curves, Forest plots by subgroup, waterfall plots for biomarkers

---

## SAP Section Guide

Use this guide to know **what to look for** and **where it typically lives** when reading SAP documents.

### Common SAP structures

Most SAPs follow one of these organizational patterns:

#### ICH E9 / Industry standard layout
1. Introduction / Study overview
2. Study objectives and endpoints
3. Study design
4. Analysis populations
5. Statistical methods
   - 5.1 Primary efficacy analysis
   - 5.2 Secondary efficacy analyses
   - 5.3 Safety analyses
   - 5.4 Exploratory analyses
   - 5.5 Subgroup analyses
   - 5.6 Interim analyses
6. Missing data handling
7. Sample size determination
8. Changes from protocol
9. References
10. Appendix: List of tables, figures, and listings
11. Appendix: Mock TLG shells

#### CDISC-influenced layout
Similar to above but may include additional sections on:
- Data standards and ADaM dataset specifications
- Define.xml metadata
- Traceability from endpoints to analyses to TLGs to ADaM datasets

#### Company-specific layouts
Some sponsors use numbering like:
- Section 14: Tables (matching CSR section 14)
- Section 16: Listings (matching CSR section 16)
This is a helpful signal -- the TLG numbering often mirrors the planned CSR structure.

### Extraction map: Where to find each schema field

| Schema section | Primary SAP location | Fallback location |
|---|---|---|
| `study_identification` | Section 1 (Introduction) | Protocol title page |
| `study_design.type` | Section 2 or 3 (Study Design) | Protocol synopsis |
| `study_design.treatment_arms` | Section 2/3 or a design figure | Protocol Section on Treatments |
| `populations` | Section 4 (Analysis Populations) | Sometimes within Section 5 methods |
| `endpoints.primary` | Section 2 (Objectives and Endpoints) | Protocol Section on Objectives |
| `endpoints.secondary` | Section 2 | Protocol Section on Objectives |
| `statistical_analyses.primary` | Section 5.1 | -- |
| `statistical_analyses.secondary` | Section 5.2 | -- |
| `missing_data` | Section 6 or within Section 5 | Sometimes a separate appendix |
| `baseline_definition` | Section 5 (often in a "general conventions" subsection) | Sometimes in Section 4 |
| `visit_schedule` | Protocol (Schedule of Assessments) | SAP may reference it without reproducing it |
| `sample_size` | Section 7 or a dedicated subsection | Protocol synopsis |
| `planned_tlg_list` | Appendix (List of Data Displays) | May be a separate shell document |
| `subgroup_analyses` | Section 5.5 | Sometimes embedded in primary analysis |
| `interim_analyses` | Section 5.6 or a separate DMC SAP | Protocol section on interim |

### Key phrases to search for

When scanning a document, these phrases help locate critical information:

**Populations:**
- "analysis set", "analysis population", "evaluable population"
- "intent-to-treat", "full analysis set", "modified intent-to-treat"
- "per-protocol", "safety population", "pharmacokinetic population"
- "All randomized subjects", "All subjects who received at least one dose"

**Endpoint definitions:**
- "primary endpoint", "primary efficacy variable", "primary outcome"
- "secondary endpoint", "key secondary", "other secondary"
- "defined as", "assessed by", "measured by"
- "change from baseline", "time to", "proportion of subjects"
- "Overall Survival", "Progression-Free Survival", "Objective Response Rate"

**Statistical methods:**
- "analyzed using", "will be analyzed by", "the primary analysis will"
- "ANCOVA", "MMRM", "logistic regression", "Cox proportional hazards"
- "Kaplan-Meier", "log-rank test", "stratified", "adjusted for"
- "mixed model for repeated measures", "generalized linear model"

**Missing data:**
- "missing data", "imputation", "LOCF", "BOCF", "WOCF"
- "multiple imputation", "tipping point", "pattern mixture"
- "missing at random", "MAR", "MNAR"
- "estimand", "intercurrent event", "treatment policy"
- "sensitivity analysis", "supplementary analysis"

**Multiplicity:**
- "multiplicity", "alpha adjustment", "type I error"
- "gatekeeping", "hierarchical", "fixed-sequence"
- "Bonferroni", "Hochberg", "Holm", "Dunnett"
- "graphical approach", "testing procedure"

**Baseline:**
- "baseline", "baseline value", "baseline is defined as"
- "last non-missing", "pre-dose", "Day 1", "prior to first dose"
- "screening", "average of"

### Signals of document quality

**Well-structured SAP (easier extraction):**
- Numbered TLG list in appendix
- Mock shells included
- Cross-references between sections ("see Section 5.1 for the analysis of this endpoint")
- Explicit derivation rules for analysis variables

**Sparse SAP (harder extraction, more gaps expected):**
- References protocol for design details without restating them
- "Standard methods will be used" without specifics
- No mock shells or TLG list
- Missing data section is vague ("appropriate methods will be used")

When encountering a sparse SAP, flag specific gaps in `validation_summary.fields_missing` and `validation_summary.recommendations`.

### Protocol-specific extraction tips

When working from a **Protocol** (without SAP):
- The Synopsis section is often the most information-dense -- start there
- The Schedule of Assessments (SoA) table is the best source for `visit_schedule`
- Inclusion/exclusion criteria help understand the target population but aren't directly the analysis populations (those come from the SAP)
- The "Statistical Considerations" section in the Protocol is usually high-level compared to the SAP -- extract what's there but expect gaps
- Look for a sample size table or justification section

When both documents are available:
- Use the Protocol as the source of truth for study design and visit schedule
- Use the SAP as the source of truth for analysis methods, populations, and TLG plans
- If they conflict, note both versions and flag for reviewer attention
