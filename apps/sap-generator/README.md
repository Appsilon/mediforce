# SAP Generator

AI-driven generation of a **Statistical Analysis Plan (SAP)** from a clinical
trial protocol. Built for the **CDISC AI Innovation Challenge 2026, Use Case 2** —
demonstrating SAP content that is accurate, consistent, and **traceable to study
design and analysis requirements**.

SAPs are authored manually today: slow, inconsistent across studies, and weakly
traceable back to the design. This workflow generates a SAP from a protocol while
making traceability a first-class, machine-checkable artifact.

## Documentation

- [**CDISC Use Case 2 — problem & solution brief**](docs/cdisc-use-case-2-sap-generation.md) — the problem, the solution, and why it answers the challenge's accuracy/consistency/traceability criteria.
- [**Running locally**](docs/running-locally.md) — bring up Mediforce and exercise this workflow end-to-end.
- [**Protocol → SAP playbook**](docs/protocol-to-sap-playbook.md) — research findings on the CDISC standards (ARS/ADaM/USDM/E9(R1)) and how a SAP is actually derived from a protocol, from real protocol↔SAP pairs across phases 1–3 + the CDISC pilot.

## Where it fits

This app is the **upstream** half of the clinical reporting pipeline. The sibling
[`protocol-to-tfl`](../protocol-to-tfl) app *consumes* a SAP to produce Tables,
Figures, and Listings. `sap-generator` *produces* that SAP from the protocol — so
the two compose: protocol → **SAP** → metadata → ADaM → TLG.

## Pipeline

| # | Step | Executor | Input | Output |
|---|------|----------|-------|--------|
| 1 | Upload Protocol | human | Protocol PDF (+ optional metadata) | uploaded files |
| 2 | **extract-study-design** | agent (L3) | Protocol PDF | `study-design.json` |
| 3 | **draft-sap** | agent (L3) | `study-design.json` | `sap-draft.md` |
| 4 | **build-traceability** | agent (L3) | SAP draft + study design | `traceability-matrix.json`, `analysis-metadata.json` (ARS-aligned) |
| 5 | Review SAP | human (biostatistician) | the draft + matrix | approve → finalize, revise → re-draft |
| 6 | Finalize SAP | agent (L3) | review feedback | `sap-final.md` |
| 7 | Done | — | — | — |

The review step routes via verdicts: **approve** advances to finalize, **revise**
loops back to `draft-sap` with feedback.

## Traceability is the differentiator

A naive "PDF → prose" generator is not traceable. This pipeline makes the chain
explicit:

- `extract-study-design` produces a structured record whose `objectives ↔
  endpoints ↔ analysis_requirements` ids form a traceability spine, and flags
  every analysis choice the protocol is silent on as a `_sap_decision`.
- `draft-sap` tags every analysis with `[trace: …]` pointing at those ids and
  surfaces each protocol-silent choice as a visible **SAP DECISION** (never
  silently invented), collected in the SAP's "Changes from protocol" section.
- `build-traceability` harvests the tags into `traceability-matrix.json` and an
  `analysis-metadata.json` modeled on the CDISC **Analysis Results Standard
  (ARS)** — `Analysis → AnalysisMethod / AnalysisSet / GroupingFactor / Output` —
  so the plan is auditable and consumable downstream.

## Project structure

```
src/
  sap-generator.wd.json    # WorkflowDefinition (steps, transitions, triggers)
  __tests__/               # WorkflowDefinition validation tests
plugins/
  sap-generator/skills/    # Skill definitions and reference docs
    extract-study-design/
    draft-sap/
    build-traceability/
```

## Register

```bash
pnpm exec mediforce workflow register \
  --file apps/sap-generator/src/sap-generator.wd.json \
  --namespace appsilon
```

Add `--dry-run` to validate without persisting. Never register against
production.

## Test

```bash
pnpm --filter @mediforce/sap-generator test
```

Validates the WorkflowDefinition against the platform schema, that routing
(transitions + verdicts) resolves, and that every agent step's skill exists on
disk.

## Test data

Real protocol PDFs for dry-running the skills live in
[`../protocol-to-tfl/data/test-docs/`](../protocol-to-tfl/data/test-docs)
(NSCLC phase 2/3 protocols and the CDISC pilot study).
