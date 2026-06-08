# Protocol → SAP Playbook (research findings)

**Purpose.** Capture, durably and shareably, what we learned from deep research
into (1) the CDISC standards that govern statistical analysis and its
traceability, and (2) how a Statistical Analysis Plan is *actually* derived from a
protocol — evidenced by real protocol↔SAP document pairs. This is the empirical
basis for the `sap-generator` skills; the concrete skill changes it implies are
in [§4](#4-implications-for-sap-generator).

**Method / corpus.** Two sources, as briefed:
1. The **CDISC Knowledge Base** (cdisc.org/kb) and the foundational standards it
   indexes — read directly (see [Sources](#sources)).
2. **Four real protocol↔SAP pairs** spanning the phase spectrum, drawn from
   `apps/protocol-to-tfl/data/test-docs/` and read in full (PDF text extracted):
   - **CDISC pilot** — `cdiscpilot01` (Lilly LZZT xanomeline, Ph II Alzheimer's; the canonical CDISC SDTM/ADaM pilot).
   - **Phase 1** — `NCT02573259` (sasanlimab/PF-06801591, mTPI dose-escalation basket incl. NSCLC).
   - **Phase 2** — `NCT03410108` (brigatinib, single-arm ALK+ NSCLC, two-stage).
   - **Phase 3** — `NCT02542293` (NEPTUNE, durvalumab+tremelimumab vs chemo, 1L NSCLC, OS/TTE).

---

## 1. The CDISC standards landscape for SAP generation

### KB topic map
The KB is organised as **Articles, an Examples collection, Known Issues, and
portals** (eCRF, eTFL, QRS, DHT). For SAP work the load-bearing standards are:
**ADaM**, **Analysis Results Standard (ARS)**, **SDTM/SDTMIG**, **Define-XML**,
**Dataset-JSON/-XML**, **Controlled Terminology**, and the **Therapeutic Area
User Guides (TAUGs)**. Notably, **there is no dedicated "SAP" standard** — CDISC
governs the *analysis* (ADaM) and its *results/traceability* (ARS), and the SAP is
the human document that those standards make machine-traceable.

### ARS — the traceability backbone (most important)
The **Analysis Results Standard** (logical model, LinkML, first published Apr 2024)
is the object model that makes "traceable to study design" mechanical. Core
objects and how they chain:

| Object | Role |
|---|---|
| **ReportingEvent** | Root container for one reporting effort (e.g. a CSR/interim) → holds analyses, outputs, reference documents, terminology extensions. |
| **Analysis** | The central object. Links a **method** + **analysisSet** + ordered **groupingFactors** + optional **dataSubset**, plus `purpose` and `reason`. |
| **AnalysisMethod** | A reusable statistical method = an ordered set of **Operation**s. |
| **Operation** | One computation producing one result value; may reference other operations (`ReferencedOperationRelationship`). |
| **AnalysisSet** | A population, defined by a `whereClause` (simple/compound condition). |
| **DataSubset** | A further filter within a set (same where-clause machinery). |
| **GroupingFactor / Group** | Categorical split (e.g. treatment arm, subgroup); groups can be prespecified or data-driven. |
| **OperationResult / ResultGroup** | Executed results (raw + formatted), tied back to their grouping context. |
| **Output → OutputDisplay → DisplaySection → DisplaySubSection** | The TFL the analysis populates, down to section text. |
| **ReferenceDocument / TerminologyExtension / SponsorTerm** | Links to source code/docs; sponsor-controlled vocab beyond CDISC CT. |

**The chain:** SAP definition → `Analysis` spec → `Operation` execution →
`OperationResult` → `Output/Display`. This is exactly the auditable path the CDISC
challenge wants, and it is what our `analysis-metadata.json` should approximate.

### ADaM / SDTM / Define-XML / ARM / Dataset-JSON
- **ADaM** structures: **ADSL** (subject-level, required even if it's the only
  dataset), **BDS** (basic data structure, e.g. ADTTE for time-to-event, ADRS for
  response), **OCCDS** (occurrence, e.g. ADAE). ADaM's purpose is *analysis-ready*
  data + **traceability** back to SDTM.
- **Define-XML** carries the metadata for ADaM datasets; its optional **Analysis
  Results Metadata (ARM)** links a TLF result to the ADaM datasets/variables that
  produced it. **ARS is the machine-readable successor** to ARM.
- **Dataset-JSON** is the modern transport format (vs legacy SAS XPORT).

### USDM / Digital Data Flow — the structured-protocol *input*
The **Unified Study Definition Model** (CDISC, v3.0 Apr 2024; part of
TransCelerate **Digital Data Flow**) is a structured, digital representation of a
protocol: study identifiers, designs, arms, epochs, encounters, **objectives &
endpoints, populations, and estimands**. It is the standards-aligned *input* side
of SAP generation — the shape a `study-design.json` should converge toward as
structured protocols become available. Phase 4 adds **estimand** enhancements and
**ICH M11** (protocol template) alignment.

### ICH E9(R1) estimands
The estimand framework defines an analysis target via **five attributes** —
**treatment, population, variable/endpoint, intercurrent-event (IE) strategy,
population-level summary** — with five IE strategies: **treatment-policy,
hypothetical, composite, while-on-treatment, principal-stratum**. CDISC/USDM and
modern SAPs are converging on it (see the gap in [§3](#the-estimand-gap)).

### Controlled terminology & dictionaries (used by every real SAP)
**MedDRA** (AE coding, incl. SMQ/HLGT/HLT for AESI grouping), **WHO Drug**
(con-meds), **NCI CTCAE** (toxicity grading; note version matters — v4.03 vs v5),
and **RECIST 1.1 / irRECIST** (oncology response). These appear in real SAPs even
when SDTM/ADaM/ARS do not.

---

## 2. How a SAP is derived from a protocol — the transformation model

Across all four pairs the relationship is the same:

> **A SAP = elaboration + operationalization + (occasional) scope reduction of the
> protocol. It is *not* a copy, and the protocol is *not* a complete spec.**

The protocol states *intent* (objectives, endpoints, design, named methods); the
SAP turns intent into *programmable rules* and adds the entire display layer. In
statistics-rich protocols (the Phase 2/3 examples carry a full "Statistical
Methods" section) the SAP's structure is prefigured and the delta narrows to exact
estimators + operational rules + the TLG inventory; in thin protocols (the pilot)
the SAP invents far more.

### 2a. What is reliably LIFTED from the protocol (the "copy" set)
High-confidence extraction; SAPs often carry these near-verbatim (some sponsors
*italicise* protocol-sourced text — Phase 1 pair):

- Study identity: id, phase, indication, sponsor, registration id.
- Design: randomization, blinding, control, arms/doses, allocation ratio,
  **stratification factors**, schedule of assessments.
- **Objective and endpoint text** (and, in stats-rich protocols, endpoint
  definitions and censoring concepts).
- Analysis-population *concepts* and the endpoint×population matrix.
- **Sample size** assumptions (HR/effect size, power, alpha, accrual) — the
  protocol owns these; the SAP restates, it does not re-derive.
- Top-level method *names* per endpoint and the multiplicity-hierarchy *structure*.
- Interim-analysis design family (e.g. mTPI; H1-minimax two-stage; gatekeeping).

### 2b. THE DELTA — what the SAP ADDS (the "author" set)
This is where a SAP earns its keep, and where a generator must **synthesize, not
copy**. Recurring across the corpus:

| Delta category | What the SAP adds (examples seen) |
|---|---|
| **Operational populations** | Executable inclusion criteria + **evaluability/replacement rules** (e.g. DLT-evaluable replacement on >150%/<50% dosing; Efficacy = ≥1 post-baseline of *both* co-primary measures). |
| **Assessment/derivation windows** | Day-based windows keyed to randomization/first dose, with tie-break rules (closest to target; ties → earlier/later). **Almost never in the protocol.** |
| **Baseline definitions** | Which visit/value is baseline per parameter; derivation (e.g. disease duration). |
| **Imputation / missing data** | LOCF-as-primary or MMRM-under-MAR; item-level pro-rating (e.g. >30% items missing → null, else prorate); **partial-date imputation**; multiple imputation for missing biomarker; safety generally not imputed. |
| **Exact estimators (per endpoint type)** | Not generic. Continuous → **ANCOVA / MMRM** (unstructured→Toeplitz fallback). Proportion → **Clopper-Pearson exact CI** (+ logistic/Fisher mid-p fallback). Time-to-event → **(stratified) log-rank + Cox PH** (Efron ties, profile-likelihood CI); **complementary log-log** for KM milestone CIs; **bias-corrected two-stage estimators** (e.g. Kunzmann) for adaptive designs. |
| **Censoring rules (TTE)** | The **≥2-missed-visits back-censoring** rule; new-anticancer-therapy → censor; OS at last-known-alive/DCO; full censoring tables. |
| **Multiplicity, operationalized** | Gatekeeping/fixed-sequence with strong FWER control; nominal (unadjusted) p for supportive/subgroup; co-primary intersection-union (no adjustment) vs adjusted families. |
| **Subgroup grids** | Far more granular than the protocol; combinatorial biomarker subgroups; "<20 events → descriptive only" rules; interaction tests. |
| **Safety architecture** | TEAE definition + **on-treatment window**; **AESI groupings** with explicit MedDRA SMQ/HLGT/HLT/PT search strategies; **Hy's Law** bands; death taxonomy; lab shift tables + CMH; infection pooling. |
| **The TLG / shell inventory** | The single biggest SAP-only artifact. 29 shells (pilot) up to **~180** (Phase 2, driven by a base safety block × ~14 AESIs × modifiers). Plus waterfall/forest/swimmer/KM/cumulative-incidence plots. **No protocol seed.** |
| **Sensitivity battery** | NPH **max-combo / Fleming-Harrington** weighted log-rank (now standard for IO oncology); evaluation-time-bias; attrition; crossover RPSFT/IPCW. |
| **Deviations ledger** | An explicit "changes/deviations from protocol-specified analyses" section (the pilot's Appendix 2 is the model) — including **scope reductions**. |

### 2c. By-phase patterns

| | Phase 1 (dose-finding) | Phase 2 (single-arm response) | Phase 3 (randomized TTE) | CDISC pilot (Ph II) |
|---|---|---|---|---|
| Inferential? | **No** — descriptive, "no hypotheses", no power | Estimation + gating two-stage | Yes — formal tests, power, FWER | Yes — dose-response test |
| Design machinery | mTPI/3+3/BOIN; **DLT/MTD/RP2D** defs; PK **NCA derivation tables** | **Simon *or* H1-minimax** (verify!); ORR gate | (Stratified) log-rank + Cox; gatekeeping | ANCOVA + dose-response; MMRM supportive |
| Primary endpoint type | Safety/MTD (+ Part-2 ORR) | ORR / milestone PFS rate | OS / PFS (time-to-event) | Co-primary continuous (ADAS-Cog) + global (CIBIC+) |
| Estimators that dominate | NCA params, DLT rates, descriptive | Clopper-Pearson, KM cloglog | log-rank/Cox, KM landmarks, max-combo | ANCOVA, ANOVA, MMRM, K-M (AESI) |
| TLG centre of gravity | Safety/PK/dose-escalation | AE/AESI-heavy + response plots | OS/PFS KM + forest + safety | Efficacy + lab shift + Hy's Law + derm K-M |

### The estimand gap
**None of the four SAPs uses the ICH E9(R1) estimand framework** — expected given
their vintage (2006–2021, around/just before E9(R1) finalisation). Estimand-*adjacent*
thinking is present implicitly (ITT "regardless of withdrawal/subsequent therapy"
= treatment-policy; censoring rules = IE handling; MI / crossover adjustment =
sensitivity). **Implication:** a modern generator should *synthesise* the five
attributes from scattered design+analysis language and present them explicitly —
this is a forward improvement over the source SAPs, not a copy of them.

### The CDISC / ARS alignment gap (our opportunity)
**None of the four real SAPs names SDTM, ADaM, define.xml, or ARS.** They use
dictionaries (MedDRA/WHO Drug/CTCAE/RECIST) and describe TLGs in **human-readable
prose**, not machine-readable metadata. So `sap-generator` emitting an
**ARS-aligned `analysis-metadata.json` is genuinely ahead of current real-world
SAP practice** and directly serves the challenge's traceability criterion.

### Generator pitfalls (surfaced by the corpus)
1. **Don't treat the protocol as a complete spec** — it is structurally silent on
   windows, operational populations, and the entire display layer.
2. **Version skew** — SAPs key to a specific protocol *amendment*; a generator
   reading the latest protocol can produce numbers that disagree with the SAP
   (seen in both the Phase 1 and Phase 3 pairs). Pin and record the protocol
   version.
3. **Don't assume defaults** — "two-stage" was H1-minimax, not Simon; MMRM is not
   universal in Phase 3; the design choice changes the estimator. Detect, don't
   guess.
4. **Watch silent scope reductions** — the Phase 3 SAP downgraded a formal DoR
   comparison to descriptive-only; copying protocol method names verbatim
   over-states the analysis.
5. **Flag every protocol analysis as include / deviate / drop** with a rationale
   (the pilot's deviations appendix is the model).

---

## 3. Cross-cutting conclusions

1. The SAP's real content is the **delta** in [§2b](#2b-the-delta--what-the-sap-adds-the-author-set) — operational rules + the TLG inventory — most of which the protocol does not contain.
2. A generator should run in **two registers**: *lift* the copy-set faithfully, and *author* the delta with phase- and endpoint-aware defaults, **flagging every authored choice** for the biostatistician.
3. **Traceability is best expressed in ARS terms**, which also future-proofs toward USDM-structured protocol inputs and ADaM/define.xml downstream.
4. Estimands and explicit CDISC alignment are where the generated SAP can **exceed** the legacy SAPs in the corpus.

---

## 4. Implications for `sap-generator`

Concrete, recommended changes to the skills/references (proposed — see the chat
summary for status). Each maps to a finding above.

**`extract-study-design`**
- Add an explicit **"lift vs decide" split**: mark each field `source: protocol`
  (copy-set) vs `requires_sap_decision: true` (delta), so the drafter knows what
  to author. (Reinforces the existing `_sap_decision` convention.)
- Capture **stratification factors, allocation ratio, schedule of assessments,
  and protocol version/amendment id** as first-class fields (version skew, window
  derivation, stratified models all depend on them).
- Add a **`design_family`** field (e.g. `dose-escalation:mTPI`, `single-arm:two-stage:H1-minimax`, `randomized:survival`) and **do not assume** Simon/MMRM — record what the protocol actually states.

**`draft-sap` + `sap-section-template.md`**
- Add a required **"Data handling conventions"** section: assessment/derivation
  **windows**, **baseline** definitions, **imputation/missing-data**, and
  **TTE censoring rules** (incl. the ≥2-missed-visits rule). These are the most
  common SAP-only additions and were under-weighted in the current template.
- Add a required **"Changes from protocol-planned analyses" (deviations ledger)**
  — include scope *reductions*, not just additions.
- Add an **estimand section** that synthesises the five E9(R1) attributes and
  names the IE strategy, even when the protocol is silent (flagged as a SAP
  decision).
- Add **phase/endpoint-aware default estimators** guidance: ANCOVA/MMRM
  (continuous), Clopper-Pearson (proportion), (stratified) log-rank + Cox /
  cloglog KM (TTE), with NPH max-combo as a pre-specified sensitivity for IO
  oncology — each presented as a flagged default, never silently applied.
- Expand TLG-list guidance to the **base-block × AESI × modifier** pattern (the
  driver of real SAP shell counts), with MedDRA SMQ/HLGT/HLT search-strategy
  capture for AESIs.

**`build-traceability` + `ars-object-guide.md`**
- Align object names/relationships to the **actual ARS model**: `Operation` under
  `AnalysisMethod`, `whereClause` on `AnalysisSet`/`DataSubset`, ordered
  `GroupingFactor`s, `Output → OutputDisplay → DisplaySection`, `ReferenceDocument`.
- Note the **ADaM target datasets** each analysis implies (ADSL/ADTTE/ADRS/ADAE)
  to bridge toward `protocol-to-tfl`, and reference **ARM/define.xml** lineage.

A separate set of **realistic test fixtures** (the canonical CDISC pilot is ideal:
small, clean, fully SDTM/ADaM-annotated) should back a future dry-run.

---

## Sources

CDISC standards (read via web):
- [CDISC Knowledge Base](https://www.cdisc.org/kb)
- [Analysis Results Standard](https://www.cdisc.org/standards/foundational/analysis-results-standard) · [ARS logical model docs](https://cdisc-org.github.io/analysis-results-standard/) · [ARS GitHub](https://github.com/cdisc-org/analysis-results-standard)
- [ADaM](https://www.cdisc.org/standards/foundational/adam) · [Define-XML](https://www.cdisc.org/standards/data-exchange/define-xml)
- [Digital Data Flow / USDM](https://www.cdisc.org/ddf)
- [Getting Started with the CDISC ARS (PHUSE DS04, 2024)](https://www.lexjansen.com/phuse-us/2024/ds/PAP_DS04.pdf)

Document corpus (read in full, in `apps/protocol-to-tfl/data/test-docs/`):
- `cdiscpilot01/` — CDISC SDTM/ADaM pilot (LZZT xanomeline, Ph II).
- `nsclc-phase1/NCT02573259` · `nsclc-phase2/NCT03410108` · `nsclc-phase3/NCT02542293`.

*Note: real SAPs are written in classical "variable + population + method" terms,
without estimands or named CDISC dataset/metadata standards. The opportunity for
`sap-generator` is to add exactly those traceability layers on top of the
well-understood protocol→SAP transformation documented here.*
