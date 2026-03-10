---
name: trial-metadata-extractor
description: "Extract structured metadata from clinical trial Protocol and Statistical Analysis Plan (SAP) documents into a standardized JSON format. Use this skill whenever the user provides a Protocol, SAP, or both (as file paths or uploaded files) and wants to extract study design, endpoints, populations, visit schedules, analysis plans, or any structured trial metadata. Also trigger when the user mentions 'protocol review', 'SAP review', 'trial metadata', 'study design extraction', 'endpoint extraction', 'ADaM planning', 'TLG planning', or wants to prepare inputs for mock TLG shell generation. This skill is the first step in a Protocol->SAP->Metadata->TLG pipeline. Even if the user only provides one document (Protocol OR SAP), use this skill -- it handles partial inputs gracefully and flags what's missing."
---

# Trial Metadata Extractor

## Purpose

This skill reads clinical trial Protocol and/or SAP documents (PDF, DOCX, or text) and produces a structured JSON metadata file that captures everything needed to plan ADaM datasets and generate mock TLG shells downstream.

The output JSON serves as a **contract** between this extraction step and the `mock-tlg-generator` skill. It must be comprehensive enough that a biostatistician could review it and confirm it faithfully represents the trial design and statistical plan.

## When to use

- User provides a Protocol and/or SAP file path and asks for structured extraction
- User wants to review or summarize trial design elements
- User is preparing for ADaM dataset planning or TLG shell creation
- User asks to "parse", "extract", "summarize", or "structure" a clinical trial document
- User mentions wanting metadata for downstream automation

## Workflow

### Step 1: Identify and read the input documents

The user will typically provide one or more of:
- PDF file paths (Protocol and/or SAP) — read them with the Read tool (supports PDFs up to 20 pages per read; for large documents read in chunks by section)
- Files already pasted into the conversation context

Document pairing convention in this project: files in `test-docs/` are named `{NCT_ID}_Prot_*.pdf` and `{NCT_ID}_SAP_*.pdf`. Match by NCT ID.

Handle partial inputs:
- **Protocol only** → Extract what's available, flag SAP-dependent fields as `"source": "not_available_from_protocol"`
- **SAP only** → Extract analysis plan details, flag protocol-dependent fields similarly
- **Both** → Full extraction, cross-reference between documents

### Step 2: Extract metadata into the standardized schema

Read the schema reference file before extraction:
```
references/output-schema.md
```

Extract information systematically by working through each section of the schema. For each field:
1. Search the source document(s) for relevant sections
2. Extract the information faithfully — do not invent or assume
3. If information is ambiguous, include a `"_notes"` field explaining the ambiguity
4. If information is absent, use `null` with a `"_notes"` explaining what's missing and where it would typically be found

**Critical principles:**
- **Fidelity over completeness**: Never fabricate information. It's better to have `null` fields with notes than wrong data.
- **Preserve source language**: For endpoint definitions, population criteria, and derivation rules, use the document's exact wording (these are regulatory-grade definitions where paraphrasing introduces risk).
- **Flag judgment calls**: If you had to interpret ambiguous text, add a `"_reviewer_attention"` field explaining what needs human verification.
- **Cross-reference**: When both Protocol and SAP are available, note discrepancies. The SAP typically takes precedence for analysis-related decisions, while the Protocol takes precedence for study design.

### Step 3: Validate and enrich

After initial extraction, perform these validation checks:
1. **Endpoint-to-analysis consistency**: Every primary and secondary endpoint should have at least one corresponding entry in `statistical_analyses`
2. **Population completeness**: All populations referenced in analyses should be defined in `populations`
3. **Visit schedule coverage**: Endpoints that reference specific visits should have those visits in `visit_schedule`
4. **Treatment arm alignment**: Analysis comparisons should reference defined treatment arms

Add a `"validation_summary"` section at the end of the JSON listing any gaps or inconsistencies found.

### Step 4: Output the JSON

Save the extracted metadata to `outputs/{NCT_ID}-trial-metadata.json` (create the `outputs/` directory in the project root if it doesn't exist).

Also present a concise summary to the user covering:
- Study identification (title, phase, indication)
- Number of treatment arms and key populations
- Primary endpoint(s) and their planned analyses
- Count of expected TLGs (if derivable)
- Any gaps or items flagged for reviewer attention

### Step 5: Offer next steps

After presenting the metadata, inform the user that:
- The JSON can be reviewed and edited before feeding into mock TLG generation
- Any `null` fields or `_reviewer_attention` flags should be resolved
- The `mock-tlg-generator` skill can consume this JSON to produce TLG shells

## Handling edge cases

**Large PDFs**: Most Protocol and SAP documents exceed 20 pages. Use targeted page ranges with the Read tool — start with the first 5 pages (title, synopsis, TOC) to orient, then read specific sections relevant to each schema field. The `sap-section-guide.md` reference lists where key information typically appears.

**Incomplete documents**: Some SAPs are posted without mock shells for disclosure. Some protocols are early drafts. Always extract what's available and clearly document gaps.

**Non-standard structure**: SAPs vary significantly between sponsors and CROs. Focus on extracting the semantic content rather than expecting specific section numbering. Common SAP sections to look for:
- Study objectives and endpoints
- Study design description
- Analysis populations
- Statistical methods (for each endpoint)
- Missing data handling / imputation rules
- Subgroup and sensitivity analyses
- Interim analyses
- List of planned tables, figures, and listings

**Multiple indications or cohorts**: Some trials (especially basket/umbrella designs) have multiple cohorts. Create nested structures under `design.cohorts` rather than flattening.

**Amendments**: If the document references protocol amendments, extract the current (amended) version of any changed elements and note the amendment in `_notes`.

## Reference files

- `references/output-schema.md` — The complete JSON schema with field descriptions and examples. **Always read this before extraction.**
- `references/sap-section-guide.md` — Guide to common SAP structures and where to find key information across different company formats.
