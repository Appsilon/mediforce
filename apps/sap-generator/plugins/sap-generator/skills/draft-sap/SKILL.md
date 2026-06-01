---
name: draft-sap
description: "Author a Statistical Analysis Plan (SAP) document from a structured study-design.json record, following the ICH E9 / industry section layout. Use this skill as the second step of SAP generation, after extract-study-design has produced study-design.json, or when applying biostatistician review feedback to revise an existing SAP draft. Every analysis the SAP specifies must cite the study-design field it derives from; protocol-silent choices are proposed as defensible defaults and flagged for the reviewer, never silently invented. Trigger on 'draft the SAP', 'write the statistical analysis plan', 'generate SAP sections', or 'revise the SAP'."
---

# Draft SAP

## Purpose

Generate a complete **Statistical Analysis Plan** (`sap-draft.md`) from
`study-design.json`, following the standard ICH E9 / industry section layout.
On revision passes, apply the biostatistician's feedback to the existing draft.

The SAP is regulatory-grade. The non-negotiable rule:

> **Every method, population, and endpoint in the SAP traces to a
> `study-design.json` field. Where the protocol is silent, propose a defensible
> default and flag it — never invent study-specific content as if it came from
> the protocol.**

## When to use

- After `extract-study-design` produced `study-design.json` and the user wants
  the SAP drafted.
- On the `finalize` step, to apply review feedback and reconcile the draft with
  the traceability matrix.

## Workflow

### Step 1: Load inputs

Read, in order:

1. `outputs/study-design.json` — the structured study design (required input).
2. `references/sap-section-template.md` — the section-by-section template and
   the per-section source-field map. **Always read this before drafting.**
3. On a revision pass: the existing `outputs/sap-draft.md` and the reviewer's
   feedback (passed as step input), plus `outputs/traceability-matrix.json` if
   present.
4. Any supporting inputs the user uploaded (prior-SAP template, sponsor
   conventions) — use them for house style and section ordering only.

### Step 2: Draft each section

Work through the template's sections in order. For each section:

1. Pull the relevant fields from `study-design.json` (the template names them).
2. Write the section in clear regulatory prose.
3. **Cite the source.** End each analysis specification with an inline trace tag
   of the form `[trace: <study-design path or id>]` — e.g.
   `[trace: analysis_requirements/AR-PRI-1, endpoints.primary/EP-PRI-1]`. These
   tags are what `build-traceability` harvests; keep the ids exact.
4. **Resolve `_sap_decision` items explicitly.** When a field carried a
   `_sap_decision` (the protocol was silent on a method, imputation, or
   multiplicity choice), write the defensible default and wrap it in a reviewer
   flag: `> ⚠️ SAP DECISION (not in protocol): <choice> — <one-line rationale>.`
   Never present a SAP-introduced choice as protocol-derived.
5. Preserve the exact protocol wording for endpoint and population definitions.

### Step 3: Sections to produce

Follow `references/sap-section-template.md`. At minimum:

1. Introduction & study overview
2. Study objectives and endpoints
3. Study design
4. Analysis populations
5. Statistical methods — general principles
6. Statistical methods — primary efficacy analysis
7. Statistical methods — secondary analyses
8. Statistical methods — safety analyses
9. Subgroup and sensitivity analyses
10. Missing data handling (and estimand framing if applicable)
11. Multiplicity / Type I error control
12. Interim analyses (if any)
13. Sample size determination
14. Changes from the protocol-planned analyses (lists every SAP DECISION)
15. Appendix: List of planned Tables, Figures, and Listings (TLGs)

### Step 4: Self-check before writing out

- Every primary and secondary endpoint has a named analysis in §6–§7.
- Every analysis names its population (defined in §4) and its comparison.
- Every `_sap_decision` from `study-design.json` appears as a SAP DECISION flag
  and is collected in §14.
- Every analysis specification carries a `[trace: …]` tag with ids that exist in
  `study-design.json`.
- No method, threshold, or population was introduced without either a protocol
  source or a SAP DECISION flag.

### Step 5: Output

Save the SAP to `outputs/sap-draft.md` (on the finalize step, save the
reconciled result to `outputs/sap-final.md`). Then present a concise summary:

- Sections written and total length.
- Count of SAP DECISION flags (and list them) — these are the reviewer's
  highest-priority items.
- Any endpoint or population that could not be given a complete analysis (should
  be zero; if not, explain why).

### Step 6: Offer next steps

Tell the user the draft is ready for `build-traceability` (which validates the
`[trace: …]` tags into a matrix) and then biostatistician review.

## Revision passes (finalize step)

When invoked with reviewer feedback:

1. Treat the feedback as authoritative. Apply each requested change.
2. Re-run the Step 4 self-check after editing.
3. If a reviewer instruction conflicts with the protocol (e.g. asks for a method
   the design cannot support), make the change but add a SAP DECISION flag noting
   the deviation, rather than silently overriding the protocol trace.
4. Keep `[trace: …]` tags intact and update §14 if the set of SAP DECISIONs
   changed.

## Reference files

- `references/sap-section-template.md` — section-by-section template with the
  source-field map and prose conventions. **Always read before drafting.**
