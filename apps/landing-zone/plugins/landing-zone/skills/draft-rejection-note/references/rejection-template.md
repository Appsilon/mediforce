# Rejection Note Template

Skeleton for the markdown rejection note. Placeholders are wrapped in curly braces; the agent fills them from `input.json` and `/workspace/findings.json`. Square-bracketed items (e.g., `[CRO contact name]`) are left unresolved on purpose — the operator fills those in before sending.

The template has two variants: one for the **findings path** (validation produced findings the reviewer rejected) and one for the **script-failure path** (validation harness crashed). Pick exactly one based on the input state. Do not blend both.

---

## Variant A — Findings path

Use when `scriptStatus = "ok"` and the rejection is driven by CDISC findings.

```markdown
Hi [CRO contact name],

Thank you for the latest delivery for **{studyId}** (delivery `{deliveryId}`, received {receivedDate}). After running CDISC CORE validation against {standardLabel}, we are unable to ingest this package as-is and need a corrected resend.

## Summary

- Total findings: **{findingsCount}** ({criticalCount} Critical, {majorCount} Major, {minorCount} Minor, {warningCount} Warning)
- Domains affected: {domainList}
- Validation standard: {standardLabel} {igVersion}

## Top issues

{topFindingsList}

A complete list of findings is available on request — we can share the structured CORE output if it helps your team triage.

## What we need to retry

To proceed with this delivery, please address the following:

{remediationBullets}

Once the corrected package is uploaded to the SFTP landing zone, our pipeline will pick it up automatically on the next poll.

Happy to discuss any of the findings if useful — feel free to reply with questions.

Thanks,
[Operator name]
```

### Field-fill guidance

- `{studyId}` — from `STUDY_ID` env or `input.json.variables.studyId`
- `{deliveryId}` — from input; fall back to basename of `deliveryDir`
- `{receivedDate}` — date the delivery first appeared (from `input.json` if present; otherwise leave a placeholder `[date received]`)
- `{standardLabel}` — `"SDTM"` / `"ADaM"` / `"SEND"` from env (`VALIDATION_STANDARD`) or input. Capitalise.
- `{igVersion}` — from env (`VALIDATION_IG_VERSION`) or input
- `{findingsCount}`, `{criticalCount}`, `{majorCount}`, `{minorCount}`, `{warningCount}` — counts from findings array. Use `0` not blank when a level is absent.
- `{domainList}` — comma-separated list of distinct `domain` values present in findings, sorted alphabetically. Cap at 10; if more, append `, plus N others`.
- `{topFindingsList}` — markdown bullet list. One bullet per finding for the top 10 by severity then domain. Format:
  ```
  - **{ruleId}** in `{domain}`: {message} ({severity}, {affectedCount} record(s))
  ```
  If `affectedCount` is unknown, omit that parenthetical entirely.
- `{remediationBullets}` — short list (3–6 items) derived from the top findings. Group similar findings into one bullet. Examples:
  - `- Repopulate \`AESTDTC\` with ISO 8601 dates throughout the AE domain (currently {n} records have free-text dates).`
  - `- Resolve duplicate \`USUBJID\` + \`LBSEQ\` pairs in the LB domain ({n} duplicates).`
  - `- Use \`LBTESTCD\` values from the CDISC controlled terminology codelist (current values exceed the 8-character limit).`
  Each bullet must reference a concrete fix, not a vague platitude. Do not propose fixes whose data you do not have.

---

## Variant B — Script-failure path

Use when `scriptStatus = "failed"` (the validation harness could not run to completion).

```markdown
Hi [CRO contact name],

Thank you for the latest delivery for **{studyId}** (delivery `{deliveryId}`, received {receivedDate}). Our CDISC validation harness was unable to process the package, so we are unable to confirm acceptance and need a corrected resend.

## What happened

{failureSummary}

This means we cannot run the CDISC CORE rules engine against the delivery, so we have no findings list to share — the issue is upstream of validation.

## What we need to retry

{failureRemediationBullets}

Once a corrected package is uploaded to the SFTP landing zone, our pipeline will pick it up automatically on the next poll.

Please reply if you need more detail on the failure mode — happy to share specifics.

Thanks,
[Operator name]
```

### Field-fill guidance

- `{failureSummary}` — one or two plain-language sentences derived from the validator skill's `summary` and the `error` field. Translate any technical jargon into something a CRO data manager will understand. Examples:
  - `"The LB dataset could not be opened as a SAS XPORT v5 file. The file may have been generated in a different format or may have been corrupted in transit."`
  - `"No CDISC SDTM domains were detected in the uploaded files. The package may be missing the dataset files, or the filenames may not match the expected pattern (e.g., \`dm.xpt\`, \`ae.xpt\`)."`
  - `"One or more files use a character encoding the validator did not expect. Please ensure files are exported with default SAS XPORT encoding (typically Windows-1252 or UTF-8)."`
  Do not include the raw traceback. Do not include container paths.
- `{failureRemediationBullets}` — short list keyed to the failure mode. Examples:
  - For "no domain found": confirm filenames match expected SDTM pattern; confirm files are XPT not e.g. CSV.
  - For "encoding error": re-export with default encoding; verify file is not partially uploaded.
  - For "infrastructure" failures (CORE CLI not installed, OOM, etc.): say plainly that the failure was on our side and we will retry without requiring action from the CRO. **In that case, write a single bullet** acknowledging the issue is internal and offer to keep the CRO informed.

---

## Style notes that apply to both variants

- One blank line between paragraphs. No double-blank lines.
- Use `**bold**` for the study ID and total counts, backticks for code-like values (`{deliveryId}`, variable names, file extensions).
- Do not use emoji.
- Do not use exclamation marks.
- Do not say "unfortunately" or "we apologise" — the note is informational, not contrite.
- Do not commit the operator to a specific timeline ("we will get back to you within 24 hours") unless that information is in the input.
- Sign off with `[Operator name]` literally — the operator replaces it before sending.
