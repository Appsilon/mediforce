# SAP Section Template

A section-by-section template for authoring the SAP from `study-design.json`,
following the ICH E9 / industry-standard layout. For each section this lists the
**source fields** to pull and the **prose conventions** to follow. The layout
mirrors the structure documented in the `protocol-to-tfl` SAP section guide, so a
SAP authored here is shaped the way the downstream extractor expects to read one.

## Global conventions

- **Voice**: declarative, future tense ("The primary endpoint will be analyzed
  using …"). Regulatory SAPs describe a pre-specified plan.
- **Trace tags**: end each analysis specification with `[trace: <ids>]` pointing
  at the `study-design.json` element(s) it derives from. `build-traceability`
  harvests these. Keep ids exact.
- **SAP DECISION flags**: any choice the protocol did not make is written as a
  defensible default and flagged:
  `> ⚠️ SAP DECISION (not in protocol): <choice> — <rationale>.`
- **Definitions**: quote endpoint and population definitions verbatim from
  `study-design.json` (which preserved protocol wording). Do not paraphrase
  regulatory definitions.

## Section map

### 1. Introduction & study overview
Source: `study_identification`, `study_design.type`.
Content: study id/title, sponsor, phase, indication, compound, a one-paragraph
design summary, and the purpose/scope of this SAP. State the SAP version and the
protocol version it corresponds to.

### 2. Study objectives and endpoints
Source: `objectives`, `endpoints.{primary,secondary,exploratory,safety}`.
Content: list objectives by type; under each, its endpoints with verbatim
definitions and endpoint `type`/`timing`. One subsection per objective tier.
`[trace: objectives/<id>, endpoints.<tier>/<id>]`.

### 3. Study design
Source: `study_design` (type, randomization, blinding, control, allocation_ratio,
stratification_factors, treatment_arms, adaptive_details, cohorts).
Content: describe arms, allocation, blinding, and stratification. Reproduce the
treatment-arm table. `[trace: study_design]`.

### 4. Analysis populations
Source: `populations`.
Content: one subsection per population with its verbatim definition and what it is
primary for. State explicitly which population is used for efficacy vs safety.
`[trace: populations/<id>]`.

### 5. Statistical methods — general principles
Source: `baseline_definition`, `visit_schedule`, sponsor conventions.
Content: significance level and sidedness, continuous/categorical summary
conventions (n, mean, SD, median, range / counts and %), baseline definition,
visit windows, software, handling of derived variables. Flag any convention not
fixed by the protocol as a SAP DECISION.

### 6. Statistical methods — primary efficacy analysis
Source: `analysis_requirements` where `purpose == "primary"`, the referenced
`endpoints.primary` and `populations`, `sample_size`, `multiplicity`.
Content: for each primary analysis — population, statistical model/test,
comparison, covariates, hypothesis (and margin if NI/equivalence), estimand if
applicable, and the estimate/CI reported. If `method` was null in the source,
specify a defensible default and add a SAP DECISION flag.
`[trace: analysis_requirements/<id>, endpoints.primary/<id>, populations/<id>]`.

### 7. Statistical methods — secondary analyses
Source: `analysis_requirements` where `purpose == "secondary"`.
Content: same structure as §6 per secondary endpoint. Note where secondary tests
are gated by the multiplicity strategy (§11).

### 8. Statistical methods — safety analyses
Source: `endpoints.safety`, `analysis_requirements` where `purpose == "safety"`,
the safety `populations`.
Content: AE summaries (TEAEs, by SOC/PT, by severity/CTCAE grade, SAEs, AEs of
special interest), exposure, labs/vitals/ECG summaries, deaths. Time-to-event
safety analyses (e.g. time to first AE of interest) use Kaplan-Meier — specify
censoring. Safety is descriptive unless the protocol specifies a test.
`[trace: endpoints.safety/<id>, analysis_requirements/<id>]`.

### 9. Subgroup and sensitivity analyses
Source: `analysis_requirements` where `purpose in {subgroup, sensitivity}`,
`study_design.stratification_factors`.
Content: list subgroups and sensitivity analyses; state each as supportive (not
confirmatory) unless the protocol says otherwise.

### 10. Missing data handling
Source: `missing_data`.
Content: the handling approach and, if `estimand_framework` is set, the estimand
(treatment-policy / hypothetical / etc.) and intercurrent-event handling. Specify
the imputation method (e.g. MMRM under MAR, multiple imputation, tipping-point
sensitivity). If `_sap_decision` was present, this is a SAP DECISION.

### 11. Multiplicity / Type I error control
Source: `multiplicity`, the set of confirmatory endpoints.
Content: the testing strategy (hierarchical/fixed-sequence, Hochberg, graphical,
gatekeeping) and the alpha allocation. If the protocol was silent and there is
more than one confirmatory endpoint, propose a strategy as a SAP DECISION.

### 12. Interim analyses
Source: `interim_analyses`.
Content: timing, purpose (efficacy/futility/safety), alpha-spending function and
stopping boundaries, and the DMC's role. Omit the section if there are none.

### 13. Sample size determination
Source: `sample_size`.
Content: planned N (total and per arm), power, alpha, effect-size/variability
assumptions, and the calculation method. Reproduce the protocol's justification.

### 14. Changes from the protocol-planned analyses
Source: every SAP DECISION flag raised above; `validation_summary.sap_decisions`.
Content: a numbered list of every analysis choice the SAP introduced or changed
relative to the protocol, each with its rationale. This section is the auditable
record of what the SAP added beyond the protocol — keep it complete.

### 15. Appendix: List of planned TLGs
Source: derived from §6–§9 analyses and the safety plan.
Content: a numbered list of planned Tables, Figures, and Listings, each with a
title, the analysis it presents, and its population. Use CSR-aligned numbering
(Section 14 tables, Section 16 listings) when sponsor conventions indicate it.
This list is the hand-off to mock-TLG generation downstream.

## Quality signals

A strong generated SAP:
- has a named, population-qualified analysis for every primary and secondary
  endpoint;
- carries a `[trace: …]` tag on every analysis;
- lists every SAP-introduced choice in §14 (and nowhere silently);
- reproduces endpoint/population definitions verbatim from the source.
