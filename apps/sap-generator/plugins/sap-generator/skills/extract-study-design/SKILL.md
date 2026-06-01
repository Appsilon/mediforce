---
name: extract-study-design
description: "Extract a structured study-design record from a clinical trial Protocol (and optional supporting metadata such as an annotated CRF or sponsor conventions) into a standardized JSON file. Use this skill as the first step of SAP generation, whenever the user provides a Protocol PDF and wants to author a Statistical Analysis Plan. Unlike SAP extraction, this skill reads the Protocol ONLY — the SAP does not exist yet, it is what the pipeline will generate. The output study-design.json is the input contract for the draft-sap skill. Trigger on 'generate a SAP', 'draft a statistical analysis plan', 'protocol to SAP', 'extract study design', or when preparing inputs for SAP authoring."
---

# Extract Study Design

## Purpose

Read a clinical trial **Protocol** (PDF, DOCX, or text) plus any supporting
metadata inputs and produce a structured `study-design.json` capturing everything
a biostatistician needs to author a Statistical Analysis Plan (SAP).

This is the **first step of the SAP-generation pipeline**. The output JSON is the
**contract** consumed by the `draft-sap` and `build-traceability` skills. It must
be faithful enough that a biostatistician could review it and confirm it
represents the trial design and the analysis requirements implied by the
protocol.

> **Note on direction.** The sibling `protocol-to-tfl` app extracts metadata from
> a Protocol *and* an existing SAP to drive TLG generation. This skill is the
> upstream half: it reads the **Protocol only**, because the SAP is the artifact
> we are about to generate. The output schema is intentionally **compatible**
> with `protocol-to-tfl`'s trial-metadata contract so the two apps chain.

## When to use

- User provides a Protocol PDF and asks to generate or draft a SAP
- User wants the study design structured before SAP authoring
- User is preparing inputs for the `draft-sap` skill

## Workflow

### Step 1: Identify and read the input documents

The user provides one or more of:

- The Protocol PDF (required) — read it with the Read tool (PDFs up to 20 pages
  per read; for large documents read in targeted page ranges by section).
- Optional supporting inputs: an annotated CRF, a prior-SAP template, or sponsor
  TLG/statistical conventions. Use these only to inform defaults and house style
  — the Protocol is the source of truth for design, objectives, and endpoints.

Most protocols exceed 20 pages. Start with the first ~5 pages (title page,
synopsis, table of contents) to orient, then read the specific sections relevant
to each schema field. The **Synopsis** and the **Statistical Considerations**
section are usually the most information-dense; the **Schedule of Assessments**
(SoA) table is the best source for the visit schedule.

### Step 2: Extract into the standardized schema

Read the schema reference before extraction:

```
references/study-design-schema.md
```

Work through each section of the schema. For each field:

1. Search the protocol for the relevant section.
2. Extract faithfully — **do not invent or assume**.
3. If information is ambiguous, add a sibling `"_notes"` field explaining the
   ambiguity.
4. If information is absent, use `null` with a `"_notes"` explaining what is
   missing and where it would normally appear.
5. When a field will require a SAP-authoring decision the protocol does not make
   (e.g. the exact imputation method, the multiplicity procedure), set the value
   to `null` and add a `"_sap_decision"` note describing the decision the
   `draft-sap` skill must make and flag for the reviewer.

**Critical principles**

- **Fidelity over completeness.** A `null` field with a note is better than wrong
  data. The SAP is regulatory-grade.
- **Preserve source language.** For endpoint definitions, population criteria,
  and derivation rules, quote the protocol's exact wording — paraphrasing
  regulatory definitions introduces risk.
- **Flag judgment calls.** When you interpret ambiguous text, add a
  `"_reviewer_attention"` field naming what needs human verification.
- **Search ALL sections for statistical methods.** Protocols specify methods
  beyond the primary-efficacy section. Explicitly check safety and exploratory
  sections. Common methods to look for across all sections: ANCOVA, ANOVA, MMRM,
  Kaplan-Meier, log-rank, Cox proportional hazards, Fisher's exact, CMH
  (Cochran-Mantel-Haenszel), chi-square, Wilcoxon, t-test. Time-to-event analyses
  (e.g. for AE onset) frequently live in safety sections.
- **Protocol methods are high-level.** The protocol's Statistical Considerations
  section is usually less detailed than a SAP. Extract what is there; mark
  expected gaps with `"_sap_decision"` so the drafting step knows what it must
  specify.

### Step 3: Validate and enrich

After initial extraction, check:

1. **Objective → endpoint coverage**: every objective maps to at least one
   endpoint.
2. **Endpoint → analysis-requirement coverage**: every primary and secondary
   endpoint has an `analysis_requirements` entry (method named or flagged as a
   `_sap_decision`).
3. **Population completeness**: every population referenced by an analysis
   requirement is defined in `populations`.
4. **Treatment-arm alignment**: planned comparisons reference defined arms.
5. **Visit coverage**: endpoints referencing specific visits have those visits in
   `visit_schedule`.

Add a `"validation_summary"` section listing gaps, inconsistencies, and the set
of `_sap_decision` items the drafting step must resolve.

### Step 4: Output the JSON

Save to `outputs/study-design.json` (create the `outputs/` directory in the
workspace root if it does not exist). Then present a concise summary:

- Study identification (title, phase, indication, sponsor)
- Number of treatment arms and key populations
- Primary endpoint(s) and the analysis requirement(s) implied
- Count of `_sap_decision` items the SAP must resolve
- Anything flagged for reviewer attention

### Step 5: Offer next steps

Tell the user that `study-design.json` can be reviewed and edited before SAP
drafting, that `null` fields and `_reviewer_attention` / `_sap_decision` flags
should be resolved or will be flagged by the drafting step, and that the
`draft-sap` skill consumes this JSON.

## Handling edge cases

- **Sparse protocols / early drafts**: extract what is available; mark gaps. Do
  not fill them.
- **Amendments**: extract the current (amended) value of changed elements and
  note the amendment in `_notes`.
- **Multiple cohorts (basket/umbrella)**: nest under `study_design.cohorts`
  rather than flattening.
- **Non-standard structure**: focus on semantic content, not section numbering.

## Reference files

- `references/study-design-schema.md` — the complete JSON schema with field
  descriptions. **Always read this before extraction.** Compatible with the
  `protocol-to-tfl` trial-metadata contract.
