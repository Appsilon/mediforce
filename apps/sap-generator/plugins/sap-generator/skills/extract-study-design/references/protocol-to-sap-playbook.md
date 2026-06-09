# Protocol → SAP Playbook (agent reference)

Operational guidance for turning a protocol into a SAP, distilled from real
protocol↔SAP pairs (CDISC pilot + NSCLC phases 1/2/3) and CDISC standards. Use it
as the mental model behind every step.

> Canonical, fuller version: `apps/sap-generator/docs/protocol-to-sap-playbook.md`.
> Keep this distilled copy in sync when that changes.

## The core model

> **A SAP = elaboration + operationalization + (occasional) scope reduction of the
> protocol. It is NOT a copy, and the protocol is NOT a complete spec.**

The protocol states *intent* (objectives, endpoints, design, named methods); the
SAP turns intent into *programmable rules* and adds the entire display layer. Work
in two registers: **lift** what the protocol reliably states, **author** the
delta — and **flag every authored choice** for the biostatistician.

## What is reliably LIFTED from the protocol (copy-set, high confidence)

- Study identity (id, phase, indication, sponsor, registration/NCT id).
- Design: randomization, blinding, control, arms/doses, **allocation ratio**,
  **stratification factors**, schedule of assessments.
- **Objective and endpoint text** (verbatim; in stats-rich protocols, also
  endpoint definitions and censoring concepts).
- Analysis-population *concepts* and the endpoint×population matrix.
- **Sample size** assumptions (HR/effect size, power, alpha, accrual) — the
  protocol owns these; the SAP restates, never re-derives.
- Top-level method *names* per endpoint; multiplicity-hierarchy *structure*;
  interim design *family*.

## THE DELTA — what the SAP ADDS (author-set; synthesize, never copy)

| Category | What to author |
|---|---|
| Operational populations | Executable inclusion criteria + evaluability/replacement rules (e.g. DLT-evaluable replacement; "≥1 post-baseline of both co-primary measures"). |
| Assessment/derivation windows | Day-based windows keyed to randomization/first dose + tie-break rules. **Almost never in the protocol.** |
| Baseline definitions | Which visit/value is baseline per parameter; derivations. |
| Imputation / missing data | LOCF or MMRM-under-MAR; item-level pro-rating; partial-date imputation; MI for missing biomarker; safety usually not imputed. |
| Exact estimators | Per endpoint type (see table below) — not generic. |
| Censoring rules (TTE) | ≥2-missed-visits back-censoring; new-anticancer-therapy → censor; OS at last-known-alive/DCO. |
| Multiplicity, operationalized | Gatekeeping/fixed-sequence, strong FWER; nominal p for supportive/subgroup; co-primary intersection-union (no adjustment). |
| Subgroup grids | Far more granular than protocol; "<20 events → descriptive only"; interaction tests. |
| Safety architecture | TEAE definition + on-treatment window; AESI groupings with MedDRA SMQ/HLGT/HLT/PT search strategies; Hy's Law bands; death taxonomy; lab shift tables + CMH. |
| TLG / shell inventory | The biggest SAP-only artifact: base safety block × ~14 AESIs × modifiers + KM/forest/waterfall/swimmer plots. **No protocol seed.** |
| Sensitivity battery | NPH max-combo / Fleming-Harrington (IO oncology); evaluation-time-bias; attrition; crossover RPSFT/IPCW. |
| Deviations ledger | Explicit "changes from protocol-planned analyses", including scope *reductions*. |

## Default estimators by endpoint type (propose as flagged defaults)

- **Continuous (change from baseline):** ANCOVA (baseline + factors); MMRM under
  MAR (unstructured → Toeplitz fallback) as primary/supportive.
- **Binary / proportion (ORR, DCR):** point estimate + **Clopper-Pearson exact**
  2-sided CI; logistic regression / Fisher mid-p where comparative.
- **Time-to-event (OS, PFS, DOR):** **(stratified) log-rank** test + **Cox PH**
  (Efron ties, profile-likelihood CI) for HR; **Kaplan-Meier** medians; milestone
  rates with **complementary log-log** CI. Stratify by the randomization factors.
- **IO oncology:** include **NPH max-combo** as a pre-specified sensitivity.
- **Single-arm Phase 2 gate:** two-stage design — **verify Simon vs H1-minimax**;
  the design choice changes the point estimator (e.g. bias-corrected weighted).
- **Phase 1:** descriptive; DLT/MTD/RP2D definitions; PK NCA parameter derivation.

## Estimands (ICH E9(R1)) — synthesize, don't expect them in the source

Real SAPs (pre-2022) rarely use the framework, but a modern SAP should state, per
confirmatory endpoint, the five attributes — **treatment, population,
variable/endpoint, intercurrent-event (IE) strategy, population-level summary** —
and name the IE strategy (treatment-policy / hypothetical / composite /
while-on-treatment / principal-stratum). Source material is scattered (ITT
"regardless of withdrawal" = treatment-policy; censoring rules = IE handling).
Construct it and flag as a SAP DECISION when the protocol is silent.

## CDISC / ARS / ADaM alignment

Real SAPs name dictionaries (MedDRA, WHO Drug, CTCAE, RECIST) but rarely SDTM/
ADaM/define.xml/ARS. Our edge is to add the machine-readable traceability layer:
express analyses in **ARS** terms and note the **ADaM** datasets each implies
(ADSL; ADTTE for OS/PFS/DOR; ADRS for response; ADAE for AEs).

## Pitfalls

1. Don't treat the protocol as a complete spec — it's silent on windows,
   operational populations, and the display layer.
2. **Version skew** — a SAP keys to a specific protocol *amendment*; record the
   protocol version the design was extracted from.
3. **Don't assume defaults** — detect the actual design/method (Simon vs
   H1-minimax; MMRM is not universal); the design changes the estimator.
4. Watch **silent scope reductions** (e.g. a formal DoR comparison downgraded to
   descriptive) — copying protocol method names verbatim over-states the analysis.
5. Flag every protocol analysis as **include / deviate / drop** with a rationale.
