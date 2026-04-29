---
name: draft-rejection-note
description: "Draft a professional, factual markdown rejection note that the operator forwards to the CRO after a delivery is rejected at human review. Use this skill in the landing-zone workflow only when the human reviewer has rejected a delivery — the note explains what was wrong with the data and what the CRO needs to fix before resending. The note is NOT auto-sent. Triggers: 'draft rejection note', 'compose CRO email', 'rejection draft', 'landing zone reject path'."
---

# Draft Rejection Note

## Purpose

After a human reviewer rejects a CDISC validation delivery, this skill composes a markdown note for the operator. The operator pastes the note into their own email channel and sends it to the CRO; nothing is auto-sent.

The note exists so the reviewer does not have to write the same kind of message every time a delivery fails. The agent assembles facts from the validation findings into a structured, polite, action-oriented message that names what was wrong and what is needed to retry.

## When to use

Runs as the `draft-rejection-note` agent step in the landing-zone workflow. Reached only when `human-review` returned the `reject` verdict. Receives the same validation-related state the human reviewer saw, plus whatever rejection metadata the human-review step attached.

## Inputs

- **`/output/input.json`** — engine-provided step input. Carries the prior step outputs (the `data-validator` skill's `result.json`, the `validate-script` output, and any human-review metadata).
- **`/workspace/findings.json`** — the persisted CDISC CORE findings. Same file the validator skill read.

Pull from `input.json`:

- The validator's classification, summary, and `scriptFailedFlag`
- `scriptStatus`, `error`, `traceback` from `validate-script`
- `deliveryId`, `deliveryDir`
- Any human reviewer comment / verdict metadata (field name varies — look for `verdictReason`, `humanComment`, `reviewerNote`, or similar; if absent, proceed without it)
- `STUDY_ID` and any other study-config fields available via `input.json.variables` or env

Do not hardcode study IDs, CRO names, or any contact information. All identifiers come from inputs.

## Workflow

### Step 1 — Read inputs

Read `/output/input.json` and `/workspace/findings.json`. If the workspace findings file does not exist, that is OK on the rejection path — sometimes the rejection is itself driven by a failed validation script. Branch:

- **Validation script failed** (`scriptFailedFlag = true` or `scriptStatus = "failed"`): the rejection reason is the script failure. Frame the note around what the CRO needs to provide so the validation can run.
- **Validation produced findings the reviewer rejected**: the rejection reason is the findings. Frame the note around the most important findings.

If both signals are present, lead with the script failure — it is the upstream cause.

### Step 2 — Pick the severity descriptor

Set `severity` (one of `critical`, `major`, `minor`) for the `result.json` based on:

- `critical` — script failed, OR any Critical-severity finding present, OR a Structure-category finding present
- `major` — at least one Major-severity finding present, no Critical
- `minor` — only Minor or Warning findings

Severity is for triage on the operator side; it does not dictate the tone of the note.

### Step 3 — Compose the markdown note

Read `references/rejection-template.md` and use it as the structural skeleton. Fill the placeholders with values from `input.json` and `/workspace/findings.json`. Keep the tone:

- **Professional and factual.** State what was found. Do not editorialise. Do not apologise on behalf of the CRO. Do not assign blame.
- **Action-oriented.** Make clear what the CRO needs to do to enable a retry.
- **Concise.** A reviewer should be able to scan the note in under 30 seconds.

When you list findings, group by domain and lead with the highest-severity items. If there are more than 10 findings, list the top 10 and mention the total count with a pointer that the full set is available in the validation report.

When the script failed: do not include a findings list (there are none). Instead summarise the failure plainly — e.g., "The validation harness could not parse the LB dataset; the file appears not to be a valid SAS XPORT v5 transport file." If the validator skill already extracted a partial signal (in its `summary`), reuse that wording rather than re-deriving.

Include placeholders the operator will fill: at minimum a salutation `[CRO contact name]` and a sign-off `[Operator name]`. Do not invent contact names. Do not put email addresses in the note.

### Step 4 — Suggest a subject line

Set `suggestedSubject` for the `result.json`. Format: `[{studyId}] Delivery {deliveryId} — rejected ({short reason})`. Examples:

- `[CDISCPILOT01] Delivery 2026-04-28-1430 — rejected (validation script failed)`
- `[CDISCPILOT01] Delivery 2026-04-28-1430 — rejected (24 CDISC findings, 3 Critical)`

Keep under 100 characters. Do not include emoji or marketing language.

### Step 5 — Write `/output/result.json`

Exact shape:

```json
{
  "rejectionNote": "the full markdown body, ready to paste",
  "suggestedSubject": "single-line subject string",
  "severity": "critical" | "major" | "minor"
}
```

The markdown is pasted as-is by the operator. Do not include leading/trailing whitespace beyond a single trailing newline. Do not wrap it in code fences.

### Step 6 — Render the HTML preview (optional but expected for v0.1)

Write `/output/presentation.html`. The reviewer panel renders the file in a sandboxed iframe with Tailwind v4 already loaded; `window.__data__` exposes the result JSON.

Required structure:

1. **Header** — "Draft rejection note for delivery {deliveryId}". Show the `severity` value as a badge using the same colour mapping the validator skill uses (critical → red, major → amber, minor → slate).
2. **Subject preview** — the `suggestedSubject` in a monospaced block, with a "Copy subject" button.
3. **Note preview** — the rendered markdown of `rejectionNote`. The simplest reliable approach is to render line by line: `\n\n` becomes paragraph breaks, lines starting with `- ` become `<li>`, headings (`#`, `##`) become `<h2>`/`<h3>`. Do not pull in a markdown library.
4. **Copy-to-clipboard button** for the full note. Vanilla JS only — `navigator.clipboard.writeText(window.__data__.rejectionNote)`. Provide a visible success indicator after click (e.g., button label flips to "Copied" for two seconds).
5. **Footer note** — small print: "Not auto-sent. Forward this note from your own email account to the CRO contact for {studyId}." Pull `studyId` from input/env; if absent, render the placeholder `{studyId}` literally.

The HTML must be self-contained — no external scripts, no fetches. Sandboxed iframe will block them.

## Constraints

- The note text is in English. The CRO contact may speak another language; that is the operator's call to translate or rewrite. Do not write multilingual versions.
- Do not include the full traceback in the note body. Tracebacks are engineering artefacts and not appropriate to send outside the org. Summarise the failure in plain language.
- Do not include any internal URLs, paths from `/workspace/`, or container-side filenames (`/output/...`). The CRO has no context for those.
- Do not propose remediation that requires data the agent cannot verify (e.g., do not say "the CRO should re-run with CT version X" unless the findings explicitly indicate a CT-version mismatch).
- Do not auto-send. v0.1 is draft-only.
- Do not invent CRO names, contact persons, study sponsor names, or compound names. Use placeholders.

## Edge cases

- **No findings and no script failure but the human still rejected** — rare; happens when the human spotted something the validator missed. Read any `verdictReason` / `humanComment` field on the input and use that as the lead in the note ("Issues identified during manual review: ..."). If no comment is available, write a brief note saying the operator should fill in the reason.
- **`deliveryId` missing** — fall back to the basename of `deliveryDir`. If both are missing, use `unknown` and add a placeholder line in the note for the operator to clarify.
- **Findings file unreadable but `scriptStatus = ok`** — treat it as a script failure (the audit record is missing); say so in the note.

## Reference files

- `references/rejection-template.md` — markdown skeleton with placeholders for the agent to fill from inputs. Read this before composing the note in Step 3.
