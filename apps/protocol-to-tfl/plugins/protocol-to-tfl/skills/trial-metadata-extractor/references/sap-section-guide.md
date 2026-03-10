# SAP Section Guide

This reference helps locate key information across different SAP formats. SAPs vary significantly between sponsors and CROs, but the content is broadly consistent. Use this guide to know **what to look for** and **where it typically lives**.

## Common SAP structures

Most SAPs follow one of these organizational patterns:

### ICH E9 / Industry standard layout
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

### CDISC-influenced layout
Similar to above but may include additional sections on:
- Data standards and ADaM dataset specifications
- Define.xml metadata
- Traceability from endpoints → analyses → TLGs → ADaM datasets

### Company-specific layouts
Some sponsors use numbering like:
- Section 14: Tables (matching CSR section 14)
- Section 16: Listings (matching CSR section 16)
This is a helpful signal — the TLG numbering often mirrors the planned CSR structure.

## Extraction map: Where to find each schema field

| Schema section | Primary SAP location | Fallback location |
|---|---|---|
| `study_identification` | Section 1 (Introduction) | Protocol title page |
| `study_design.type` | Section 2 or 3 (Study Design) | Protocol synopsis |
| `study_design.treatment_arms` | Section 2/3 or a design figure | Protocol Section on Treatments |
| `populations` | Section 4 (Analysis Populations) | Sometimes within Section 5 methods |
| `endpoints.primary` | Section 2 (Objectives and Endpoints) | Protocol Section on Objectives |
| `endpoints.secondary` | Section 2 | Protocol Section on Objectives |
| `statistical_analyses.primary` | Section 5.1 | — |
| `statistical_analyses.secondary` | Section 5.2 | — |
| `missing_data` | Section 6 or within Section 5 | Sometimes a separate appendix |
| `baseline_definition` | Section 5 (often in a "general conventions" subsection) | Sometimes in Section 4 |
| `visit_schedule` | Protocol (Schedule of Assessments) | SAP may reference it without reproducing it |
| `sample_size` | Section 7 or a dedicated subsection | Protocol synopsis |
| `planned_tlg_list` | Appendix (List of Data Displays) | May be a separate shell document |
| `subgroup_analyses` | Section 5.5 | Sometimes embedded in primary analysis |
| `interim_analyses` | Section 5.6 or a separate DMC SAP | Protocol section on interim |

## Key phrases to search for

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

## Signals of document quality

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

When encountering a sparse SAP, flag specific gaps in `validation_summary.fields_missing` and `validation_summary.recommendations` so the user knows what to supplement before proceeding to TLG generation.

## Protocol-specific extraction tips

When working from a **Protocol** (without SAP):
- The Synopsis section is often the most information-dense — start there
- The Schedule of Assessments (SoA) table is the best source for `visit_schedule`
- Inclusion/exclusion criteria help understand the target population but aren't directly the analysis populations (those come from the SAP)
- The "Statistical Considerations" section in the Protocol is usually high-level compared to the SAP — extract what's there but expect gaps
- Look for a sample size table or justification section

When both documents are available:
- Use the Protocol as the source of truth for study design and visit schedule
- Use the SAP as the source of truth for analysis methods, populations, and TLG plans
- If they conflict, note both versions and flag for reviewer attention
