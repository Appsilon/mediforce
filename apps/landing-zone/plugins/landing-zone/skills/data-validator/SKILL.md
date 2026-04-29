---
name: data-validator
description: "Interpret CDISC CORE rules engine output for a single SFTP delivery, classify the delivery as clean, has-findings, or escalate, and render a self-contained HTML report for a human reviewer. Use this skill when the prior step (validate-script) has produced findings or has failed and the task is to triage what happened and present it to an operator. Triggers: 'interpret validation', 'classify findings', 'review CDISC CORE output', 'validation report for human review', 'landing zone interpret'. This skill is the agent half of the validate -> human-review handoff."
---

# Data Validator

## Purpose

Read the output of a deterministic CDISC CORE validation step and turn it into:

1. A short machine-readable verdict (`/output/result.json`)
2. A self-contained HTML report (`/output/presentation.html`) that renders inline in the human reviewer's task UI

The validation script (`validate-script` step) is the source of truth for facts. This skill does **not** re-run the rules engine and does **not** invent findings — it interprets, classifies, and presents what the script already produced.

## When to use

This skill runs as the `interpret-validation` agent step in the landing-zone workflow. It receives:

- Findings from CDISC CORE (rule-level issues across the SDTM domains in a delivery), **or**
- A script-failure signal if the validation harness itself crashed

The downstream `human-review` step reads the HTML report this skill writes; the human picks accept or reject.

## Inputs

The container has two read paths:

- **`/output/input.json`** — the engine-provided step input. Contains the `validate-script` step output under the standard step-output shape:
  ```json
  {
    "scriptStatus": "ok" | "failed",
    "deliveryId": "string",
    "deliveryDir": "/workspace/incoming/<deliveryId>",
    "findings": [...],
    "findingsCount": <integer>,
    "error": "string (only when scriptStatus=failed)",
    "traceback": "string (only when scriptStatus=failed)"
  }
  ```
  May also carry workflow-level fields the engine attached (`variables`, the previous step's full output, etc.).

- **`/workspace/findings.json`** — the same findings persisted to the run worktree by `validate-script` for audit. Always read this; if it disagrees with `/output/input.json`, prefer the workspace copy (it is the version that ended up in the run's git history).

Do not assume the structure of an individual finding beyond the fields documented in `references/cdisc-categories.md`. The CORE engine emits a flat array of finding objects; field names of interest typically include `rule_id` (or `core_id`), `domain`, `severity`, `message`, `variable`, and a count or list of affected records. Field names can vary across CORE versions — read defensively and degrade gracefully when an expected field is absent.

## Workflow

### Step 1 — Read inputs

Read `/output/input.json` first. Then read `/workspace/findings.json`. If either read fails, treat that as `scriptStatus = failed` even if the JSON in `input.json` claimed otherwise — log what went wrong in `result.summary`.

### Step 2 — Branch on scriptStatus

**If `scriptStatus === "failed"`:**

- Set `classification = "escalate"` and `scriptFailedFlag = true`
- Read the `error` and `traceback` fields. Try to extract a partial signal — common patterns:
  - `"no domain found"` / empty domain list → CRO uploaded files but none match expected SDTM domains (likely wrong filenames or wrong format)
  - `"encoding error"` / `"UnicodeDecodeError"` → file is not valid SAS XPORT or has a corrupt header
  - `"core: command not found"` / `"ModuleNotFoundError: cdisc_rules_engine"` → CORE CLI not available in the container; this is an infrastructure problem, not a CRO problem — flag it clearly
  - `"FileNotFoundError"` on the delivery dir → SFTP download lost a file between steps
  - timeout / OOM signals → partial validation; reviewer should retry rather than reject
- Compose a 1–2 sentence `summary` that names the failure category as plainly as possible. If you cannot identify the category, say so — do not guess.
- Skip the heatmap and findings list in the HTML; instead surface the error and traceback prominently.

**If `scriptStatus === "ok"`:**

- Read `findingsCount`. If `0`, set `classification = "clean"`. If `> 0`, set `classification = "has-findings"`.
- Optionally upgrade to `escalate` only when the findings indicate the validation itself is unreliable (e.g., a critical Structure-category violation that means CORE could not parse a key file). Be conservative — `has-findings` is the default for non-empty results. The human picks accept-or-reject; the agent's job is to summarise, not to pre-empt the human.

The three classifications are the v0.1 minimum and the only allowed values. Future versions will extend this set; do not invent new labels.

### Step 3 — Classify findings (only if scriptStatus=ok and findingsCount>0)

Read `references/cdisc-categories.md` for the rule-category and severity vocabulary. For each finding, derive:

- **Category** — Structure / Controlled Terminology / Consistency / FDA Business Rules / PMDA. Map by `rule_id` prefix when possible (CORE codes like `SD####`, `CT####`, `AD####`, `CG####`, `FDA####`, `PMDA####`). When a finding has no clear category, place it under "Other" — do not force a guess.
- **Severity** — Critical / Major / Minor / Warning. Use the severity field on the finding when present. If absent, leave it blank in the report — do not infer severity from `rule_id` alone.

Aggregate to a domain × category heatmap (counts of findings per cell). This drives the HTML heatmap.

### Step 4 — Compose the summary

The `summary` field of `result.json` is the at-a-glance verdict the reviewer sees in the task list before they open the HTML. Two sentences max. Examples:

- `"Clean delivery — 0 findings across 7 expected domains."`
- `"24 findings across DM, AE, LB. Mostly Controlled Terminology violations in AE; no Critical Structure issues."`
- `"Validation script crashed: CORE CLI returned 'no domain found'. Likely wrong file format from CRO."`
- `"Validation script crashed with traceback (UnicodeDecodeError on lb.xpt). File may be corrupt or non-XPORT."`

Be factual. Do not editorialise. The summary is also the explanation the agent gives for its classification.

### Step 5 — Render the HTML report

Write `/output/presentation.html`. The host iframe loads Tailwind v4 via CDN and exposes the result JSON as `window.__data__`. You can rely on Tailwind utility classes; do not re-import Tailwind.

Required sections, in order:

1. **Status banner** — full-width, top of page.
   - `scriptStatus = failed`: red background (`bg-red-600 text-white`) with the error message in plain text and a `<details>` block holding the traceback.
   - `clean`: green (`bg-green-600 text-white`) — "Delivery is clean — no findings."
   - `has-findings`: amber (`bg-amber-500 text-white`) — "{findingsCount} findings across {domainCount} domains."

2. **Header** — delivery ID, study ID (read from `STUDY_ID` env if available, otherwise from `input.json.variables`), timestamp, total findings count.

3. **Severity heatmap** — only when `scriptStatus = ok` and `findingsCount > 0`. A simple HTML table: rows = SDTM domains present in the findings, columns = the rule categories from `references/cdisc-categories.md`, cells = counts. Empty cells render blank, non-zero cells use a colour scale (light amber for 1–4, deeper amber for 5–19, red for 20+). Add a small legend.

4. **Top findings list** — only when `scriptStatus = ok`. Show the top 20 findings sorted by severity then domain. For each: rule code, domain, severity badge, brief message. If `findingsCount > 20`, add a footer line "+ N more findings — see /workspace/findings.json for full set."

5. **Failure detail** — only when `scriptStatus = failed`. The traceback inside a collapsible `<details>`. No heatmap, no findings list.

Keep the HTML self-contained. No external scripts. No fetch calls. The iframe is sandboxed; relative URLs do not resolve. Use only Tailwind utility classes — no `<style>` blocks beyond what is strictly necessary for the heatmap colour scale.

The reviewer is a human data manager. Use plain English, no marketing tone. Show counts, codes, domains, messages — not adjectives.

### Step 6 — Write `/output/result.json`

Exact shape:

```json
{
  "classification": "clean" | "has-findings" | "escalate",
  "summary": "1–2 sentence text",
  "htmlReportPath": "/output/presentation.html",
  "scriptFailedFlag": true | false
}
```

`htmlReportPath` is always `/output/presentation.html` when an HTML report was written. Omit the field if (and only if) you somehow could not write the HTML — but in v0.1 always write the HTML, even for the failure path.

## Constraints

- Do not call out to external services. Do not run `cdisc-rules-engine` yourself — that is the previous step's job.
- Do not modify `/workspace/findings.json`. It is the audit record.
- Do not invent findings, severities, or rule codes. If the data does not contain a field, omit the field; do not synthesise.
- Do not include study-specific or CRO-specific text in the HTML — pull names from `input.json` / env. The skill must work for any landing-zone study with the same inputs.
- All text in English.

## Edge cases

- **`findings` is missing or null but `findingsCount > 0`** — treat as `scriptStatus = failed` ("findings count without findings array").
- **`findings` is a very large array (>1000)** — still write the full count to the heatmap, but truncate the top-findings list to 20 with a "+ N more" footer.
- **`scriptStatus = ok` but `error` field is set** — surface the error as a note in the HTML alongside the otherwise-successful findings.
- **No `deliveryId` in input** — fall back to the directory basename of `deliveryDir`. If neither is present, label the delivery `unknown` and add a note in the summary.

## Reference files

- `references/cdisc-categories.md` — CDISC rule categories (Structure / Controlled Terminology / Consistency / FDA Business Rules / PMDA), severity levels (Critical / Major / Minor / Warning), and the rule-code prefix conventions used to map findings into categories. Read this before classification in Step 3.
