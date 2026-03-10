---
name: mock-tlg-generator
description: "Generate mock TLG (Table, Listing, and Figure) shells from structured clinical trial metadata JSON. Use this skill whenever the user has trial metadata (output from the trial-metadata-extractor skill) and wants to create mock shells, TLG shells, display shells, output shells, or mock-ups for clinical study reports. Also trigger when the user mentions 'TLG generation', 'mock shells', 'display shells', 'CSR tables', 'clinical study report outputs', 'table shells', 'listing shells', 'figure shells', or wants to plan the reporting package for a clinical trial. This skill is the second step in a Protocol->SAP->Metadata->TLG pipeline and requires metadata JSON as input -- if the user provides a Protocol/SAP instead, redirect them to the trial-metadata-extractor skill first."
---

# Mock TLG Generator

## Purpose

This skill reads structured trial metadata JSON (produced by the `trial-metadata-extractor` skill) and generates a complete set of mock TLG (Table, Listing, and Figure) shells that form the reporting package for a clinical study report (CSR).

Mock shells are the bridge between the statistical analysis plan and actual programming. Each shell defines exactly what a table, listing, or figure should look like -- column headers, row stubs, footnotes, and statistical methods -- so that a programmer can implement it without ambiguity and a biostatistician can review it for completeness.

## When to use

- User has a trial metadata JSON and wants to generate mock TLG shells
- User asks to create the reporting package, output package, or display shells
- User wants to plan what tables, listings, and figures are needed for a CSR
- User has completed the metadata extraction step and wants the next step in the pipeline

## Workflow

### Step 1: Read and validate the input metadata

Read the metadata JSON file the user provides. Validate it has the key sections needed for TLG generation:

- `study_identification` (phase, indication, therapeutic area)
- `study_design` (arms, randomization, blinding, cohorts)
- `populations` (which populations exist and their roles)
- `endpoints` (primary, secondary, exploratory, safety)
- `statistical_analyses` (methods, models, subgroups)
- `planned_tlg_list` (may be populated or null)

If critical sections are missing, inform the user what's needed before proceeding.

Also read the upstream schema for reference:

```
../trial-metadata-extractor/references/output-schema.md
```

### Step 2: Determine the TLG inventory

There are two paths depending on whether the metadata already contains a planned TLG list:

**Path A: `planned_tlg_list` has entries** -- Use the existing list as the backbone. Enrich each entry with full shell details (column headers, row stubs, footnotes). Check for gaps by comparing against the standard TLG catalog for the trial's phase and therapeutic area. Recommend additions if important TLGs are missing.

**Path B: `planned_tlg_list` is null or empty** -- Derive the complete TLG list from the endpoints, analyses, safety endpoints, and study design. Read the appropriate phase-specific catalog from the reference files to ensure completeness.

In either path, read the relevant reference file for the trial's phase:

```
references/tlg-catalog-by-phase.md
```

For therapeutic area-specific guidance (especially oncology), also read:

```
references/oncology-tlg-guide.md
```

### Step 3: Build the shell structure for each TLG

For every TLG in the inventory, generate a mock shell. Read the templates reference for structural guidance:

```
references/shell-templates.md
```

Each shell must include:

1. **Header block**: TLG ID, title (with study ID and population), page layout (portrait/landscape)
2. **Column structure**: Derived from treatment arms (for comparative studies) or dose levels/cohorts (for single-arm/dose-finding). Always include a Total column where appropriate.
3. **Row stubs**: The parameters, categories, or statistics that will populate the rows. Use `xx`, `xx.x`, `xx.xx` placeholders for numeric values and `xx (xx.x)` for count (percentage) values.
4. **Footnotes**: Abbreviation definitions, data source, statistical method references, population definition, any relevant derivation notes.
5. **Programming notes**: Which ADaM dataset(s) to use, key variables, analysis method.

#### Determining column structure

The column headers depend on the study design:

- **Randomized comparative**: One column per treatment arm + Total. Use arm names from `study_design.treatment_arms`.
- **Single-arm**: Single treatment column + Total (or just Total if one arm). May split by cohort/dose level.
- **Dose-finding (Phase 1)**: One column per dose level + Total. Use dose level IDs from `study_design.treatment_arms` or `study_design.cohorts`.
- **Subpopulation analyses**: May need separate shells or additional column groupings (e.g., by histology, by region).

#### Standard statistics placeholders

Use these placeholder formats consistently:

- Count: `xx` or `xxx`
- Percentage: `xx.x`
- Count (percentage): `xx (xx.x)` or `xxx (xx.x)`
- Mean (SD): `xx.xx (xx.xxx)`
- Median: `xx.xx`
- Min, Max: `xx.x, xx.x`
- Q1, Q3: `xx.xx, xx.xx`
- 95% CI: `(xx.xx, xx.xx)`
- Hazard ratio: `x.xxx`
- P-value: `x.xxxx` or `<0.0001`
- Rate at timepoint: `xx.x`
- KM median: `xx.x`
- N for denominator: `(N=xxx)`

### Step 4: Organize and number the TLGs

Follow the ICH E3-aligned numbering convention. The standard structure is:

```
Section 14: Tables
  14.1  Demographics and Baseline Characteristics
  14.2  Efficacy
  14.3  Safety
    14.3.1  Adverse Events
    14.3.2  Laboratory
    14.3.3  Vital Signs
    14.3.4  ECG
    14.3.5  Other Safety
  14.4  Pharmacokinetics (if applicable)
  14.5  Patient-Reported Outcomes (if applicable)

Section 16: Listings
  16.1  Demographics
  16.2  Efficacy
  16.3  Safety

Section 15: Figures (or embedded within 14.x sections)
  15.1  Efficacy Figures
  15.2  Safety Figures
  15.3  PK Figures
```

If the metadata already has TLG IDs (from `planned_tlg_list`), preserve those IDs but also provide the ICH E3 mapping. If no IDs exist, assign them following this convention.

### Step 5: Generate the output

Save the complete TLG shells package to:

```
outputs/{study-folder}/{study_id}-mock-tlg-shells.md
```

Where `{study-folder}` matches the folder structure used by the metadata extractor (e.g., `nsclc-phase3/`). If that's not determinable, use the study phase (e.g., `phase1/`, `phase2/`, `phase3/`).

The output document structure should be:

```markdown
# Mock TLG Shells — {study_id}: {short_title}

## Generation metadata

- Source: {metadata_json_path}
- Generated: {date}
- Phase: {phase}
- Design: {design_type}
- Arms: {arm_count} ({arm_names})
- Total TLGs: {count} (Tables: {t}, Listings: {l}, Figures: {f})

## TLG Index

[Complete numbered list with titles and populations]

## Table Shells

[Each table shell with full structure]

## Listing Shells

[Each listing shell with full structure]

## Figure Shells

[Each figure shell with description and axis labels]
```

### Step 6: Present summary and offer review

After generating, present the user with:

- Total TLG count breakdown (tables, listings, figures)
- Categorization by domain (demographics, efficacy, safety, PK, PRO)
- Any gaps or recommendations (TLGs that might be missing)
- Any items that need clarification from the SAP or protocol

## Key domain knowledge

### What makes a good mock shell

A mock shell should be precise enough that a SAS/R programmer can implement it without asking questions. This means:

- **Exact column headers** with N placeholders: `Drug A (N=xxx)` not just `Drug A`
- **Complete row stubs** including all categories, not just examples
- **Specific statistics** for continuous variables: whether to show mean, median, SD, range, Q1-Q3
- **Footnotes** that define abbreviations, cite the analysis population, reference the statistical method, and note the source dataset
- **Programming notes** that identify the ADaM dataset and key variables

### Phase-specific considerations

**Phase 1 (dose-finding):** Safety-heavy package. DLT summary tables are critical. PK tables are extensive (concentration-time data by visit, PK parameter summaries). Efficacy is secondary and descriptive. Columns organized by dose level.

**Phase 2 (proof-of-concept):** Balance of safety and efficacy. Response rate tables with confidence intervals. Time-to-event summaries (KM) for PFS/OS if oncology. Subgroup analyses by relevant biomarkers. May have immune-related AE categories for immunotherapy.

**Phase 3 (confirmatory):** Most extensive package. Formal hypothesis testing results. Forest plots for subgroup analyses. Sensitivity analyses for primary endpoint. Multiple populations (ITT, mITT, PP, safety). Regional subset analyses if multinational. Comprehensive safety including shift tables, exposure summaries, deaths listing.

### Common pitfalls to avoid

- Forgetting the Total column in comparative studies
- Missing footnotes for abbreviations used in the table
- Not specifying decimal precision for statistics
- Omitting the population and analysis set in the title
- Forgetting censoring notation in KM tables
- Not including "Number at risk" rows in KM figures
- Missing the p-value and CI display format in comparative tables

## Reference files

- `references/tlg-catalog-by-phase.md` -- Comprehensive catalog of standard TLGs expected at each trial phase. **Read this to ensure completeness** of the generated TLG package.
- `references/shell-templates.md` -- Concrete mock shell templates for the most common TLG types. **Read this for exact formatting** of column headers, row stubs, footnotes, and programming notes.
- `references/oncology-tlg-guide.md` -- Oncology-specific TLG guidance including RECIST response tables, KM curves, waterfall/spider/swimmer plots. **Read this for oncology trials.**
