---
name: data-validator
description: "Render a self-contained HTML report for a CDISC CORE validation delivery. The 5-class classification (clean / minor-fix / recovery / escalate / chaos) is computed deterministically by the prior validate-script step — this skill reads it from input.json and presents it. Use this skill when the prior step has produced findings or has failed and the task is to render the report a human reviewer (or downstream auto-route) will read. Triggers: 'interpret validation', 'render validation report', 'review CDISC CORE output', 'validation report for human review', 'landing zone interpret'. This skill is the agent half of the validate -> human-review handoff."
---

# Data Validator

## Purpose

Read the output of a deterministic CDISC CORE validation step plus its already-computed 5-class classification, and turn them into:

1. A short machine-readable verdict (`/output/result.json`) — echoing the deterministic classification.
2. A self-contained HTML report (`/output/presentation.html`) that renders inline in the human reviewer's task UI.

The validation script (`validate-script` step) is the source of truth for facts **and** for classification. This skill does **not** re-run the rules engine, does **not** classify, and does **not** invent findings. It loads the study-owned HTML template, fills the marked slots, and writes the result.

## When to use

This skill runs as the `interpret-validation` agent step in the landing-zone workflow. It receives:

- The CORE engine output (`Issue_Summary` rows + per-dataset details), and
- A deterministic `classification` already assigned by `validate-script` via the Python router (`router_rules.py`).

The downstream `human-review` step (or, for `clean` / `escalate` / `chaos`, an automated transition that bypasses the human) reads the HTML report this skill writes.

## Inputs

The container has three read paths:

- **`/output/input.json`** — the engine-provided step input. Contains the `validate-script` step output:
  ```json
  {
    "scriptStatus": "ok" | "failed",
    "deliveryDir": "incoming/<deliveryId>",
    "findingsPath": "findings.json" | null,
    "findingsCount": <integer>,
    "summary_data": { "datasetSummary": [...], "topRules": [...], ... },
    "classification": "clean" | "minor-fix" | "recovery" | "escalate" | "chaos",
    "classificationReason": "1-2 sentence text",
    "scriptFailedFlag": true | false,
    "summary": "1-2 sentence verdict (alias of classificationReason)",
    "error": "string (only when scriptStatus=failed)",
    "traceback": "string (only when scriptStatus=failed)"
  }
  ```
  May also carry workflow-level fields the engine attached (`variables`, etc.).

- **`/workspace/findings.json`** — the raw CORE engine output (full `Issue_Summary` + `Issue_Details` + `Conformance_Details`) persisted to the run worktree for audit. Always read this for the per-finding rows that drive the heatmap and top-findings list. If it disagrees with `/output/input.json`, prefer the workspace copy (it is the version that ended up in the run's git history).

- **`references/report-template.html`** — the canonical HTML template owned by the study repository. The skill MUST load this file and fill its slots. If it is missing, see the edge case below.

Do not assume the structure of an individual finding beyond the fields documented in `references/cdisc-categories.md`. The CORE engine emits arrays of objects; field names of interest typically include `rule_id` (or `core_id`), `dataset` (the domain), `severity`, `message`, and an issue count. Read defensively.

## Workflow

The workflow is **strict** and deterministic. The same inputs must produce the same HTML byte-for-byte, modulo the timestamp. There is no creative latitude.

### Step 1 — Load inputs

Read in this order:

1. `/output/input.json` — required. Parse JSON. Fail loud if it does not parse.
2. `/workspace/findings.json` — optional. Parse JSON; degrade gracefully on read or parse error (heatmap and findings table become empty blocks that get removed).
3. `references/report-template.html` — required. Read the raw file as a string. See edge case below if missing.

### Step 2 — Read the deterministic classification

The classification is **already computed**. Read these fields from `/output/input.json` and use them as-is:

- `classification` — one of `clean`, `minor-fix`, `recovery`, `escalate`, `chaos`. Echo in `result.json`. Do **not** recompute.
- `classificationReason` — 1–2 sentence text explaining which rule fired. Echo in `result.summary`.
- `scriptFailedFlag` — boolean. Echo verbatim.
- `summary` — alias of `classificationReason`. Use whichever is non-empty.

The five classes are the v0.1 product spec and the only allowed values. Do not invent new labels and do not "upgrade" a class based on the findings — if the script chose `recovery` and the findings look bad, still emit `recovery`. Determinism is the point.

### Step 3 — Aggregate the presentation data

Compute the following from `/workspace/findings.json`. No prose is generated here — only numbers and pass-through fields.

- **Severity counts**: total occurrences of each of Critical / Major / Minor / Warning across `Issue_Summary` rows (use the `issues` field per row, weighted). Missing or unknown severities are not bucketed into a category — they are counted in the "Unknown" badge if shown but excluded from named buckets.
- **Dataset count**: unique `dataset` values in `Issue_Summary`.
- **Heatmap matrix**: domains (rows) × categories (Structure, Controlled Terminology, Consistency, FDA Business Rules, PMDA, Other) with cell values = sum of `issues` for that pair. Use the prefix mapping from `references/cdisc-categories.md`.
- **Top findings**: top 20 rows from `Issue_Summary` sorted by `issues` desc, then `dataset` asc. Each row carries: rule code (`rule_id` or `core_id`), `dataset`, `severity`, `issues`, `message` (truncated to 200 chars).
- **Overflow note**: if `Issue_Summary` has more than 20 rows, the string `+ N more findings — see /workspace/findings.json for full set` (N = total rows minus 20). Else empty.

### Step 4 — Fill the template

Locate each `<!-- SLOT:name -->...<!-- /SLOT:name -->` marker in the template string and replace the contents between the markers. **Do not delete the marker comments themselves** — they are the contract the next run uses to recognise valid slots.

For block markers `<!-- BLOCK:name -->...<!-- /BLOCK:name -->`, either keep the block (and fill slots inside) or remove the entire block (including the marker comments) when its data is absent. Rules:

- `BLOCK:heatmap`: keep if `findingsCount > 0`, otherwise remove the whole block.
- `BLOCK:top_findings`: keep if `findingsCount > 0`, otherwise remove the whole block.
- `BLOCK:failure_detail`: keep if `scriptFailedFlag = true`, otherwise remove the whole block.

The slots and their canonical sources:

| Slot | Value |
|------|-------|
| `study_id` | `input.variables.STUDY_ID` or `STUDY_ID` env. Fall back to `"unknown"`. |
| `header_study_id` | Same value as `study_id`. Mirrored into the brand header at the top of the report. |
| `delivery_id` | Basename of `input.deliveryDir`. Fall back to `"unknown"`. |
| `generated_at` | Current UTC time, ISO 8601 (`YYYY-MM-DDTHH:MM:SSZ`). |
| `rules_commit` | First 7 chars of `input.variables.RULES_COMMIT` if present, else `"–"`. |
| `total_findings` | `input.findingsCount` formatted as integer. |
| `count_critical` | Sum of `issues` for rows where severity = "Critical". |
| `count_major` | Sum of `issues` for rows where severity = "Major". |
| `count_minor` | Sum of `issues` for rows where severity = "Minor". |
| `count_warning` | Sum of `issues` for rows where severity = "Warning". |
| `dataset_count` | Distinct datasets in `Issue_Summary`. |
| `dataset_coverage` | One-line plain-text summary comparing `EXPECTED_DOMAINS` (env, comma-separated) against the distinct datasets in `Issue_Summary`. Format: `Expected DM, AE, LB, EX, VS, MH, CM — delivered DM, AE, LB. Missing: EX, VS, MH, CM.` If `EXPECTED_DOMAINS` is unset, render `Expected domains not configured for this study.` HTML-escape the values. |
| `status_banner` | EXACT HTML block from the canonical-copy table below — pick by `classification`. No edits. |
| `classification_explainer` | EXACT paragraph from the canonical-copy table below — pick by `classification`. No edits. |
| `heatmap_rows` | One `<tr>` per domain present, in alphabetical order. Cells with count = 0 use class `heat-0` (empty visible content). Cells 1–4 use `heat-1`, 5–19 `heat-2`, 20+ `heat-3`. |
| `findings_rows` | One `<tr>` per top finding. Severity rendered as `<span class="badge severity-{class}">{label}</span>`. |
| `findings_overflow_note` | The overflow string from Step 3, or empty. |
| `failure_error` | `input.error` (script-failed path only). Plain text, no HTML escaping bypass. |
| `failure_traceback` | `input.traceback` (script-failed path only). HTML-escape `<`, `>`, `&`. |
| `footer_timestamp` | Same as `generated_at`. |
| `footer_rules_commit` | Same as `rules_commit`. |
| `footer_total_findings` | Same as `total_findings`. |

When emitting cell counts in heatmap and findings rows, HTML-escape any user-controlled text (messages, rule codes, dataset names).

### Step 5 — Write outputs

Write the filled template to `/output/presentation.html`. Then write `/output/result.json`:

```json
{
  "classification": "clean" | "minor-fix" | "recovery" | "escalate" | "chaos",
  "classificationReason": "echoed from input",
  "summary": "echoed from input (alias of classificationReason)",
  "htmlReportPath": "/output/presentation.html",
  "scriptFailedFlag": true | false
}
```

`htmlReportPath` is always `/output/presentation.html` when an HTML report was written. Omit only if no HTML was written — but in v0.1 always write the HTML, even for the chaos path.

## Canonical copy

These are the only allowed values for `status_banner` and `classification_explainer`. Copy them verbatim. Do not rephrase, summarise, or extend.

### `clean`

**Status banner HTML:**

```html
<div class="rounded-xl px-6 py-5 bg-emerald-600 text-white">
  <div class="text-xs font-semibold uppercase tracking-wider opacity-80">Classification</div>
  <div class="text-2xl font-semibold mt-1">Clean — no findings</div>
  <p class="mt-2 text-sm opacity-90">{{classificationReason}}</p>
</div>
```

**Explainer paragraph:**

> The delivery passes every CDISC CORE rule for the standard and IG version configured for this study. No structural, terminology, consistency, or regulatory findings were raised. The workflow may accept this delivery without human review unless your study contract requires a confirmation step.

### `minor-fix`

**Status banner HTML:**

```html
<div class="rounded-xl px-6 py-5 bg-sky-600 text-white">
  <div class="text-xs font-semibold uppercase tracking-wider opacity-80">Classification</div>
  <div class="text-2xl font-semibold mt-1">Minor fix — terminology drift</div>
  <p class="mt-2 text-sm opacity-90">{{classificationReason}}</p>
</div>
```

**Explainer paragraph:**

> The majority of findings are Controlled Terminology violations — values that fall outside the codelist version configured for this study. These usually resolve with a codelist version bump or a value-level fix at the CRO, and rarely block ingestion. Review the top findings to confirm the pattern, then accept or return the delivery with a short remediation note.

### `recovery`

**Status banner HTML:**

```html
<div class="rounded-xl px-6 py-5 bg-amber-500 text-white">
  <div class="text-xs font-semibold uppercase tracking-wider opacity-80">Classification</div>
  <div class="text-2xl font-semibold mt-1">Recoverable — single-domain issue</div>
  <p class="mt-2 text-sm opacity-90">{{classificationReason}}</p>
</div>
```

**Explainer paragraph:**

> Critical structural findings are confined to a single SDTM domain. The rest of the delivery is parseable and the issue is recoverable with a targeted fix at the CRO. Review the affected domain in the heatmap, then either reject the delivery with a fix request or accept with a follow-up if your contract allows partial ingestion.

### `escalate`

**Status banner HTML:**

```html
<div class="rounded-xl px-6 py-5 bg-red-600 text-white">
  <div class="text-xs font-semibold uppercase tracking-wider opacity-80">Classification</div>
  <div class="text-2xl font-semibold mt-1">Escalate — multi-domain structural failure</div>
  <p class="mt-2 text-sm opacity-90">{{classificationReason}}</p>
</div>
```

**Explainer paragraph:**

> Critical structural findings span two or more SDTM domains, which prevents ingestion as a coherent package. This pattern typically indicates a problem with the CRO's build pipeline rather than individual data points. The delivery should be rejected and the CRO asked to regenerate the package; partial-domain acceptance is not safe at this scale.

### `chaos`

**Status banner HTML:**

```html
<div class="rounded-xl px-6 py-5 bg-zinc-900 text-white">
  <div class="text-xs font-semibold uppercase tracking-wider opacity-80">Classification</div>
  <div class="text-2xl font-semibold mt-1">Chaos — validation could not complete</div>
  <p class="mt-2 text-sm opacity-90">{{classificationReason}}</p>
</div>
```

**Explainer paragraph:**

> Validation did not complete cleanly — either the rules engine errored, the delivery was unreadable, or structural failures span the majority of expected domains. The findings below (if any) are partial and should not be treated as a complete picture. Open the failure detail to see the error and traceback before deciding on next steps; in most cases the delivery should be returned to the CRO without further automated handling.

In each banner block, `{{classificationReason}}` is the only string the skill substitutes — replace it with `input.classificationReason` (HTML-escaped). Everything else is fixed.

## What you MUST NOT do

- **Do not** add new sections to the report.
- **Do not** reorder existing sections.
- **Do not** rewrite, paraphrase, expand, or shorten the canonical banner or explainer copy.
- **Do not** generate prose anywhere outside the marked slots.
- **Do not** introduce new colours, fonts, or layout primitives in the filled template.
- **Do not** classify or re-classify the delivery. Echo `input.classification`.
- **Do not** invent findings, severities, rule codes, or messages.
- **Do not** modify `/workspace/findings.json` or any other workspace file.
- **Do not** call external services, fetch URLs at render time, or embed scripts beyond what the template already loads.
- **Do not** ship a different template path. The template lives at `references/report-template.html` and nowhere else.

If you find yourself wanting to write a paragraph the template does not have a slot for, stop. The slot is missing on purpose. Open a follow-up issue against this repo or the study repo instead.

## Constraints

- **Do not classify.** Deterministic Python router does it. Echo.
- All text in English.
- The skill must work for any landing-zone study with the same input shape; study-specific text comes from `input.json` and env, never hard-coded here.

## Edge cases

- **`classification` missing from input** — fall back to `chaos`, render the chaos banner, and surface the missing-classification fact in the failure-detail section. Should never happen in production.
- **`/workspace/findings.json` unreadable** — still render banner, header, key metrics (showing `0` where computation requires findings), and explainer. Remove `BLOCK:heatmap` and `BLOCK:top_findings`. Add a one-line note inside `BLOCK:failure_detail` describing the missing file.
- **`references/report-template.html` missing** — write a minimal fallback HTML containing only the banner (using the canonical copy from this skill) plus a notice that the template was not found at `references/report-template.html`. Do not invent a layout. Still write `result.json` normally.
- **Raw findings array very large (>1000 rows)** — heatmap shows full counts; top-findings list truncates to 20 with the overflow note.
- **`scriptStatus = ok` but `error` field is set** — render the failure-detail block alongside the heatmap. Banner is driven by classification, not the error field.
- **No `deliveryId` in input** — fall back to the directory basename of `deliveryDir`. If neither, label `"unknown"`.

## Reference files

- `references/cdisc-categories.md` — CDISC rule categories (Structure / Controlled Terminology / Consistency / FDA Business Rules / PMDA), severity levels, and the rule-code prefix conventions used to map findings into categories. Read this before building the heatmap. The same prefix mapping is applied internally by the Python router that assigned the classification.
- `references/report-template.html` — the canonical HTML template with `<!-- SLOT:name -->` and `<!-- BLOCK:name -->` markers. The skill MUST load this file and fill its slots; never invent a layout.
- `references/report-style.md` — editorial and visual contract (layout, palette, typography, tone, iframe constraints). Read this when modifying the template; do not regenerate copy from it at render time.

Template, style guide, and skill logic ship and version together — change them in the same commit when slot or block markers are added, renamed, or removed.
