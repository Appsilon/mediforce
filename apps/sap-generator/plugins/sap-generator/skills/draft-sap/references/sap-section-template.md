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

## Default methods by design family & endpoint type

Pick the method from `study_design.design_family` and the endpoint `type`. These
are **defaults proposed as SAP DECISIONs** when the protocol does not name a
method — never silently applied. Detect the design; do not assume.

| Endpoint type | Default method | CI / summary |
|---|---|---|
| Continuous, change from baseline | ANCOVA (baseline + design factors); **MMRM** under MAR (unstructured → Toeplitz fallback) as primary/supportive | LS-mean difference + 95% CI |
| Binary / proportion (ORR, DCR) | proportion; logistic regression / Fisher mid-p if comparative | **Clopper-Pearson exact** 2-sided CI |
| Time-to-event (OS, PFS, DOR) | **(stratified) log-rank** test + **Cox PH** (Efron ties) | HR + profile-likelihood CI; **Kaplan-Meier** medians; milestone rates with **complementary log-log** CI |
| Categorical / ordered | CMH (stratified) / chi-square | n (%) |
| Count / rate | Poisson / negative-binomial or exposure-adjusted rate | rate per 100 patient-years |

Design-family riders:
- **randomized:survival (Phase 3 IO):** stratify by the randomization factors;
  include **NPH max-combo / Fleming-Harrington** as a pre-specified sensitivity.
- **single-arm:two-stage:** the design (**Simon vs H1-minimax**) sets the point
  estimator — an adaptive two-stage design needs a bias-corrected estimator, not
  the naïve proportion. Reproduce the stage boundaries.
- **dose-escalation (mTPI/3+3/BOIN):** descriptive; define DLT-evaluability,
  MTD/RP2D determination, and PK NCA parameter derivations.

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
conventions (n, mean, SD, median, range / counts and %), software, handling of
derived variables. Flag any convention not fixed by the protocol as a SAP DECISION.

### 6. Estimands
Source: confirmatory `endpoints` + `analysis_requirements`; `missing_data`;
ITT/treatment-policy language in the design.
Content: for **each confirmatory (primary and key-secondary) endpoint**, state the
five **ICH E9(R1)** attributes — treatment condition, population, variable/
endpoint, **intercurrent-event (IE) strategy**, population-level summary — and
name the IE strategy (treatment-policy / hypothetical / composite /
while-on-treatment / principal-stratum). Real protocols rarely state estimands
explicitly: **synthesize** them from scattered design + analysis language (ITT
"regardless of withdrawal/subsequent therapy" → treatment-policy; censoring rules
→ IE handling) and flag the whole section as a SAP DECISION when the protocol is
silent. `[trace: endpoints.<tier>/<id>, analysis_requirements/<id>]`.

### 7. Data handling conventions
Source: `visit_schedule`, `baseline_definition`, `missing_data`; mostly
SAP-authored (the protocol is usually silent — these are SAP DECISIONs).
Content — the operational rules the protocol does not contain:
- **Assessment/derivation windows**: day-based windows keyed to randomization/
  first dose (`study day = assessment date − reference date + 1`), per assessment
  class, with tie-break rules (closest to target; ties → earlier or later — state
  which).
- **Baseline definitions**: which visit/value is baseline per parameter; how
  derived (e.g. last non-missing pre-dose).
- **Missing data / imputation**: the approach (LOCF, MMRM under MAR, multiple
  imputation, tipping-point); item-level rules (e.g. prorate unless >X% items
  missing); **partial-date imputation**; what is *not* imputed (usually baseline
  and safety).
- **Time-to-event censoring rules**: an explicit table — e.g. event at earliest
  death/progression; **new anticancer therapy before progression → censor**;
  **progression/death after ≥2 missed assessments → censor** at last evaluable;
  OS censored at last-known-alive / DCO.

### 8. Statistical methods — primary efficacy analysis
Source: `analysis_requirements` where `purpose == "primary"`, the referenced
`endpoints.primary` and `populations`, `sample_size`, `multiplicity`,
`study_design.design_family`.
Content: for each primary analysis — population, statistical model/test (from the
**Default methods** table, chosen by design family + endpoint type), comparison,
covariates, hypothesis (and margin if NI/equivalence), the estimand it targets
(§6), and the estimate/CI reported. If `method` was null in the source, specify
the defensible default and add a SAP DECISION flag.
`[trace: analysis_requirements/<id>, endpoints.primary/<id>, populations/<id>]`.

### 9. Statistical methods — secondary analyses
Source: `analysis_requirements` where `purpose == "secondary"`.
Content: same structure as §8 per secondary endpoint. Note where secondary tests
are gated by the multiplicity strategy (§12).

### 10. Statistical methods — safety analyses
Source: `endpoints.safety`, `analysis_requirements` where `purpose == "safety"`,
the safety `populations`.
Content: define **TEAE** (start within the on-treatment window) and the
**on-treatment window** itself; AE summaries (by SOC/PT, severity/CTCAE grade,
SAEs); **adverse events of special interest (AESI)** as grouped summaries, each
with its **MedDRA search strategy** (SMQ / HLGT / HLT / manual PT list); lab/vital/
ECG shift tables (CMH stratified by baseline where used); **Hy's Law** liver-safety
bands; a death taxonomy. Time-to-event safety analyses (e.g. time to first AESI)
use Kaplan-Meier — specify censoring. Safety is descriptive unless the protocol
specifies a test. `[trace: endpoints.safety/<id>, analysis_requirements/<id>]`.

### 11. Subgroup and sensitivity analyses
Source: `analysis_requirements` where `purpose in {subgroup, sensitivity}`,
`study_design.stratification_factors`.
Content: list subgroups (forest plots; "<20 events → descriptive only";
interaction test) and the sensitivity battery — for IO survival include **NPH
max-combo / Fleming-Harrington**; consider evaluation-time-bias, attrition, and
crossover (RPSFT/IPCW) where relevant. State each as supportive (not confirmatory)
unless the protocol says otherwise.

### 12. Multiplicity / Type I error control
Source: `multiplicity`, the set of confirmatory endpoints.
Content: the testing strategy (hierarchical/fixed-sequence, gatekeeping, Hochberg,
graphical) with strong FWER control and the alpha allocation; co-primary "both
significant" uses intersection-union (no downward adjustment); nominal
(unadjusted) p for supportive/subgroup analyses. If the protocol was silent and
there is more than one confirmatory endpoint, propose a strategy as a SAP DECISION.

### 13. Interim analyses
Source: `interim_analyses`.
Content: timing, purpose (efficacy/futility/safety), alpha-spending function and
stopping boundaries, and the DMC's role. Omit the section if there are none.

### 14. Sample size determination
Source: `sample_size`.
Content: planned N (total and per arm), power, alpha, effect-size/variability
assumptions, and the calculation method. **Reproduce the protocol's justification
— the protocol owns this; do not re-derive it.**

### 15. Changes from the protocol-planned analyses (deviations ledger)
Source: every SAP DECISION flag raised above; `validation_summary.sap_decisions`;
any protocol analysis dropped or reduced.
Content: a numbered list of every analysis choice the SAP **introduced, changed,
or reduced in scope** relative to the protocol, each with its rationale —
classify each as **include / deviate / drop**. This includes silent scope
reductions (e.g. a formal comparison downgraded to descriptive). This section is
the auditable record of what the SAP did relative to the protocol — keep it
complete.

### 16. Appendix: List of planned TLGs
Source: derived from §8–§11 analyses and the safety plan.
Content: a numbered list of planned Tables, Figures, and Listings, each with a
title, the analysis it presents, and its population. The safety displays follow a
**base block × AESI × modifier** pattern: a base TEAE block (overall, drug-related,
Grade ≥3, serious, leading to discontinuation/interruption/reduction, fatal,
over-time) replicated across each AESI group, plus lab/vital/ECG shift tables and
plots (Kaplan-Meier, forest, waterfall, swimmer). Use CSR-aligned numbering
(Section 14 tables, Section 16 listings) when sponsor conventions indicate it.
This list is the hand-off to mock-TLG generation downstream.

## Quality signals

A strong generated SAP:
- has a named, population-qualified analysis for every primary and secondary
  endpoint, with a method appropriate to the design family + endpoint type;
- states an estimand (§6) for every confirmatory endpoint and the data-handling
  conventions (§7: windows, baseline, imputation, censoring) it relies on;
- carries a `[trace: …]` tag on every analysis;
- lists every SAP-introduced, changed, or dropped choice in the §15 deviations
  ledger (and nowhere silently);
- reproduces endpoint/population definitions verbatim from the source, and does
  not re-derive the sample size.
