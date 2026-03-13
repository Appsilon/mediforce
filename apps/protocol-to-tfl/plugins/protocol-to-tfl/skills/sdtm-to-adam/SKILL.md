---
name: sdtm-to-adam
description: "Generate ADaM datasets from SDTM data using {admiral} R code, driven by mock TLG shells. Use this skill whenever the user has SDTM datasets and mock TLG shells (output from mock-tlg-generator) and wants to create ADaM datasets. Also trigger when the user mentions 'ADaM derivation', 'ADaM generation', 'SDTM to ADaM', 'admiral code', 'ADaM programming', 'ADaM spec', 'create ADaM datasets', 'generate ADaM', or wants to derive analysis datasets from SDTM. This skill is the third step in a Protocol->SAP->Metadata->TLG->ADaM pipeline. It requires mock TLG shells as primary input and SDTM datasets as data input."
---

# SDTM-to-ADaM Generator

## Purpose

This skill reads mock TLG shells (produced by the `mock-tlg-generator` skill) and SDTM datasets, then plans and generates complete ADaM datasets using `{admiral}` R code. It produces:

1. **ADaM specification markdown** — a concise spec listing every ADaM dataset needed, its key variables, derivation logic, and which TLGs it supports
2. **Individual R scripts** — one per ADaM dataset, following `{admiral}` best practices
3. **Executed ADaM datasets** — exported as Dataset-JSON files (`.json` via `{datasetjson}`)
4. **Cross-reference report** — confirming all TLG shells have their required ADaM datasets and variables
5. **Issue summary** — any SDTM data quality issues, missing domains, or derivation gaps encountered

The generated ADaM datasets must be complete enough that every mock TLG shell can be programmed from them without additional data sources.

## When to use

- User has mock TLG shells and SDTM data and wants ADaM datasets generated
- User asks to "create ADaM", "derive ADaM", "generate analysis datasets", or "run admiral code"
- User wants to go from SDTM to analysis-ready datasets
- User has completed the TLG shell generation step and wants the next step in the pipeline

## Workflow

### Step 0: Check and install required R packages

Before any R code generation or execution, verify that all required packages are installed. Run a check script:

```r
required_pkgs <- c(
  "admiral", "admiralonco", "admiralpeds", "admiralneuro",
  "admiralmetabolic", "admiralvaccine", "admiralophtha",
  "dplyr", "tidyr", "lubridate", "stringr", "rlang",
  "haven", "xportr", "datasetjson", "metacore", "metatools",
  "pharmaversesdtm"
)
missing <- required_pkgs[!sapply(required_pkgs, requireNamespace, quietly = TRUE)]
if (length(missing) > 0) {
  install.packages(missing, repos = "https://cloud.r-project.org")
}
```

Only install what is actually missing. Report to the user which packages were installed.

### Step 1: Read and analyze the mock TLG shells

Read the mock TLG shells markdown file the user provides. Extract from each shell:

- **ADaM dataset(s)** referenced in the `Source:` line and programming notes
- **Key variables** needed (e.g., AVAL, BASE, CHG, TRTP, PARAMCD, AVISIT, etc.)
- **Population flags** needed (ITTFL, SAFFL, EFFFL, etc.)
- **Derivation requirements** implied by the analysis (LOCF imputation, shift categories, visit windowing, etc.)
- **Statistical methods** that inform variable derivation (ANCOVA covariates, subgroup variables, etc.)

Build a master list: `{ADaM dataset} -> [{TLG IDs that need it}, {variables required}, {special derivations}]`

### Step 2: Inventory available SDTM data

Read the SDTM data directory provided by the user. SDTM data can come in three formats:
- **`.xpt`** (SAS transport) — read with `haven::read_xpt()`
- **`.json`** (Dataset-JSON) — read with `datasetjson::read_dataset_json()`
- **`.sas7bdat`** (SAS native) — read with `haven::read_sas()`

For each SDTM domain found:
1. Note the domain name, number of records, and key variables
2. Check for supplemental qualifier datasets (SUPP-- domains)
3. If a `define.xml` is available in the SDTM directory, read it to understand variable-level metadata (labels, controlled terminology, derivation rules)

Create a mapping: `{SDTM domain} -> {available variables, record count}`

### Step 3: Plan ADaM datasets

Cross-reference the TLG requirements (Step 1) with available SDTM data (Step 2) to plan each ADaM dataset. Read the reference guide for standard ADaM structures:

```
references/adam-dataset-guide.md
```

For each ADaM dataset needed:

1. **Identify source SDTM domains** — which SDTM datasets feed into this ADaM
2. **Map key variables** — SDTM variable -> ADaM variable mapping
3. **Define derivation logic** — how each derived variable is computed
4. **Determine population flags** — which subjects are included (from ADSL)
5. **Plan visit windowing** — if analysis visits differ from collected visits
6. **Plan imputation** — LOCF, WOCF, or other methods if required by the TLG shells

Flag any gaps:
- TLG shells requiring variables that cannot be derived from available SDTM
- SDTM domains referenced in TLG shells but not present in the data
- Derivations that require assumptions (document the assumptions)

### Step 4: Generate the ADaM specification markdown

Create a concise ADaM specification document. For each dataset include:

```markdown
## {ADAM_NAME} — {Description}

- **Structure**: {One record per subject / One record per subject per parameter per visit / etc.}
- **Source SDTM**: {List of source domains}
- **Supports TLGs**: {List of TLG IDs}
- **Key variables**:
  | Variable | Label | Type | Source/Derivation |
  |----------|-------|------|-------------------|
  | USUBJID  | Unique Subject ID | Char | DM.USUBJID |
  | ...      | ...   | ...  | ...               |
- **Population flags**: {Which flags this dataset uses}
- **Special derivations**: {LOCF, windowing, shift categories, etc.}
```

Save to: `{output_dir}/adam-spec.md`

### Step 5: Generate {admiral} R scripts

Read the admiral coding conventions reference:

```
references/admiral-coding-conventions.md
```

Generate one R script per ADaM dataset. Each script must follow this structure:

```r
# Name: {adam_name}.R
# Description: Generate {ADAM_NAME} dataset
# Source SDTM: {domains}
# Supports TLGs: {TLG IDs}
# Author: Generated by sdtm-to-adam skill
# Date: {date}

# ---- Setup ----
library(admiral)
# library(admiralonco)  # if needed for oncology-specific derivations
library(dplyr)
library(lubridate)
library(stringr)

# ---- Read source data ----
# [Read SDTM datasets based on detected format]

# ---- Derivations ----
# [admiral function calls in logical order]

# ---- Export ----
# [Export to Dataset-JSON]
```

**Script generation rules:**

1. **ADSL must be created first** — all other ADaM datasets depend on it for population flags and subject-level variables
2. **Use admiral functions** over manual derivations wherever possible:
   - `derive_vars_dt()` / `derive_vars_dtm()` for date/datetime imputation
   - `derive_vars_dy()` for study day
   - `derive_var_age_years()` for age
   - `derive_vars_merged_*()` for merging SDTM domains
   - `derive_var_extreme_flag()` for baseline/last observation flags
   - `derive_var_base()` / `derive_var_chg()` for baseline and change
   - `derive_var_shift()` for shift analysis
   - `derive_param_*()` functions for derived parameters (BMI, BSA, etc.)
   - `derive_extreme_records()` for LOCF/WOCF
   - For oncology: `admiralonco::derive_param_response()`, `derive_param_tte()`, etc.
3. **Data reading** — generate a helper function at the top of each script that detects and reads the correct format:
   ```r
   read_sdtm <- function(domain, sdtm_dir) {
     json_path <- file.path(sdtm_dir, paste0(domain, ".json"))
     xpt_path <- file.path(sdtm_dir, paste0(domain, ".xpt"))
     sas_path <- file.path(sdtm_dir, paste0(domain, ".sas7bdat"))
     if (file.exists(json_path)) {
       datasetjson::read_dataset_json(json_path)
     } else if (file.exists(xpt_path)) {
       haven::read_xpt(xpt_path)
     } else if (file.exists(sas_path)) {
       haven::read_sas(sas_path)
     } else {
       stop(paste("SDTM domain", domain, "not found in", sdtm_dir))
     }
   }
   ```
4. **Data export** — use `datasetjson` package by default:
   ```r
   # Export to Dataset-JSON
   datasetjson::write_dataset_json(adam_dataset, file.path(output_dir, "{adam_name}.json"))
   ```
   If the user requests `.xpt` format, use `xportr` instead:
   ```r
   adam_dataset %>%
     xportr_type(metacore) %>%
     xportr_label(metacore) %>%
     xportr_format(metacore) %>%
     xportr_write(file.path(output_dir, "{adam_name}.xpt"))
   ```
5. **Variable labels** — always assign labels using `attr()` or admiral's labelling utilities. ADaM datasets must have labelled variables.
6. **Controlled terminology** — use standard CDISC controlled terms (e.g., "SCREENING" not "Screen", "Y"/"N" for flag variables)

Save scripts to: `{output_dir}/code/{adam_name}.R`

### Step 6: Execute the R scripts

Run each script via `Rscript` in dependency order:

1. **ADSL** first (all other datasets merge from it)
2. **BDS datasets** next (ADAE, ADLB, ADVS, ADEX, ADQS*, etc.) — these can run in any order since they all depend only on ADSL + their source SDTM
3. **Derived/composite datasets** last (ADTTE, ADCM, any dataset that depends on other ADaM datasets)

For each script:
1. Execute via `Rscript {script_path}`
2. Capture stdout and stderr
3. If the script fails:
   - Read the error message carefully
   - Fix the R code (common issues: variable name mismatches, missing SDTM variables, type mismatches)
   - Re-execute
   - If the fix requires assumptions about the data, document them in the issue summary
4. After successful execution, verify the output file exists and is non-empty

### Step 7: Validate outputs

After all scripts have executed successfully:

1. **Record-level checks** (quick sanity, not deep validation):
   - ADSL: one row per subject, key flags present (SAFFL, ITTFL, etc.)
   - BDS datasets: expected key variables present (USUBJID, PARAMCD, AVAL, etc.)
   - Verify record counts are reasonable relative to SDTM source
2. **Cross-reference to TLG shells**:
   - For each TLG shell, confirm the referenced ADaM dataset was produced
   - For each TLG shell, confirm the key variables mentioned in programming notes exist in the produced dataset
   - Flag any TLG shells that cannot be fully supported
3. **Generate the cross-reference report** as a markdown table:

```markdown
## TLG-to-ADaM Cross-Reference

| TLG ID | TLG Title | Required ADaM | Status | Missing Variables |
|--------|-----------|---------------|--------|-------------------|
| T-1    | ...       | ADSL          | OK     | —                 |
| T-5    | ...       | ADQSADAS      | OK     | —                 |
| ...    | ...       | ...           | ...    | ...               |
```

Save to: `{output_dir}/tlg-adam-crossref.md`

### Step 8: Generate issue summary

Compile all issues encountered during the process:

```markdown
## Issue Summary

### SDTM Data Issues
- [List any missing domains, unexpected variable names, data quality issues]

### Derivation Assumptions
- [List any assumptions made during ADaM derivation]

### Unresolved Gaps
- [List any TLG requirements that could not be satisfied]

### Package Installation Notes
- [List any packages that were installed or failed to install]
```

Save to: `{output_dir}/issues.md`

### Step 9: Present summary to user

After completion, present:
- Total ADaM datasets created (with names and record counts)
- Output location
- Cross-reference summary (how many TLGs are fully/partially/not supported)
- Any critical issues requiring attention
- Suggested next steps (review ADaM spec, validate with CDISC rules engine, proceed to TLG programming)

## Output directory structure

**IMPORTANT**: Use the directory paths provided in the system prompt. If a "Workspace Directory (Git Repo)" section is present, write all deliverables there (not to the output/result contract directory). The workspace directory replaces `{output_dir}` below.

Default output structure:

```
{output_dir}/
├── adam-spec.md                    # ADaM specification document
├── code/                           # R scripts
│   ├── 00_setup.R                  # Package loading + read_sdtm helper
│   ├── 01_adsl.R                   # ADSL derivation
│   ├── 02_adae.R                   # ADAE derivation
│   ├── 03_adlb.R                   # etc.
│   └── ...
├── data/                           # Generated ADaM datasets
│   ├── adsl.json                   # Dataset-JSON format (default)
│   ├── adae.json
│   ├── adlb.json
│   └── ...
├── tlg-adam-crossref.md            # TLG-to-ADaM cross-reference
└── issues.md                       # Issue summary
```

## Handling edge cases

**Missing SDTM domains**: If a TLG shell references an ADaM dataset that requires a missing SDTM domain (e.g., TLG needs ADEG but no EG domain exists), flag it in the issue summary and skip that ADaM dataset. Proceed with all other datasets.

**Supplemental qualifiers (SUPP-- datasets)**: Always check for and merge supplemental qualifier datasets (SUPPAE, SUPPDM, etc.) into their parent domains before deriving ADaM variables. Use `admiral::combine_supp()` or manual merge by USUBJID + IDVAR + IDVARVAL.

**Non-standard SDTM variables**: If SDTM variable names don't match expected conventions, try to map them using the define.xml if available. If no define.xml, use heuristics (e.g., look for variables containing "DTC" for dates, "CD" for codes) and document assumptions.

**Large datasets**: For very large SDTM datasets, the R scripts should still work as admiral operates in-memory with dplyr. If memory is a concern, note it in the issue summary.

**Multiple questionnaire scales**: Studies with multiple PRO/cognitive instruments (like CDISC Pilot with ADAS-Cog, CIBIC+, NPI-X) may need separate ADaM datasets per scale (ADQSADAS, ADQSCIBC, ADQSNPIX) or a single ADQS with PARAMCD distinguishing them. Follow the TLG shell conventions — if shells reference separate datasets, create separate datasets.

**Oncology-specific derivations**: For oncology studies, use `{admiralonco}` functions:
- `derive_param_response()` for best overall response
- `derive_param_tte()` for time-to-event endpoints (OS, PFS, DOR)
- `derive_param_confirmed_resp()` for confirmed response
Read the `references/adam-dataset-guide.md` for oncology ADaM guidance.

**Visit windowing**: If TLG shells specify "Windowed" or analysis visits that differ from SDTM collected visits, derive AVISIT/AVISITN using windowing logic. Document the window definitions in the ADaM spec.

## Supplementary context

If the TLG shells alone are insufficient to determine derivation details, the skill may also read:
- **Trial metadata JSON** (from `trial-metadata-extractor`) for study design context, endpoint definitions, population criteria
- **Protocol/SAP PDFs** for detailed statistical methodology
- **SDTM define.xml** for variable-level metadata and controlled terminology

The user does not need to provide these explicitly — the skill can look for them in the project's standard output and test-docs directories.

## Reference files

- `references/adam-dataset-guide.md` — Standard ADaM dataset structures, SDTM-to-ADaM variable mappings, and derivation patterns for common ADaM datasets (ADSL, ADAE, ADLB, ADVS, ADEX, ADQS, ADTTE, ADCM, ADEG, ADRS, ADTR).
- `references/admiral-coding-conventions.md` — Admiral R package best practices, function reference for common derivations, code templates, and patterns for reading/writing data in different formats.
