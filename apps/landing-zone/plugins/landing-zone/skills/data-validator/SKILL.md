---
name: data-validator
description: "Render a self-contained HTML report for a CDISC CORE validation delivery. The 5-class classification (clean / minor-fix / recovery / escalate / chaos) is computed deterministically by the prior validate-script step — this skill reads it from the step input and presents it. Use this skill when the prior step has produced findings or has failed and the task is to render the report a human reviewer (or downstream auto-route) will read. Triggers: 'interpret validation', 'render validation report', 'review CDISC CORE output', 'validation report for human review', 'landing zone interpret'. This skill is the agent half of the validate -> human-review handoff."
---

# Data Validator

## Purpose

Read the output of a deterministic CDISC CORE validation step plus its already-computed 5-class classification, and turn them into:

1. A short machine-readable verdict (`/output/result.json`) — echoing the deterministic classification.
2. A self-contained HTML report (`/output/presentation.html`) that renders inline in the human reviewer's task UI.

The validation script (`validate-script` step) is the source of truth for facts **and** for classification. This skill does **not** re-run the rules engine, does **not** classify, and does **not** invent findings. It reads the verdict, presents the data clearly, and stays out of the loop.

## When to use

This skill runs as the `interpret-validation` agent step in the landing-zone workflow. It receives:

- The CORE engine output (`Issue_Summary` rows + per-dataset details), and
- A deterministic `classification` already assigned by `validate-script` via the Python router (`router_rules.py`).

The downstream `human-review` step (or, for `clean` / `escalate` / `chaos`, an automated transition that bypasses the human) reads the HTML report this skill writes.

## Inputs

The agent receives two sources of data:

- **`## Input Data` section in the prompt** — the engine-provided step input is embedded as JSON in the prompt itself (agent steps do not receive `/output/input.json` on disk; only script steps do). The fields you care about:
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

- **`/workspace/findings.json`** — the raw CORE engine output (full `Issue_Summary` + `Issue_Details` + `Conformance_Details`) persisted to the run worktree for audit. Always read this for the per-finding rows that drive the heatmap and top-findings list. If it disagrees with the prompt input, prefer the workspace copy (it is the version that ended up in the run's git history).

Do not assume the structure of an individual finding beyond the fields documented in `references/cdisc-categories.md`. The CORE engine emits arrays of objects; field names of interest typically include `rule_id` (or `core_id`), `dataset` (the domain), `severity`, `message`, and an issue count. Field names can vary across CORE versions — read defensively and degrade gracefully when an expected field is absent.

## Optional template aid

A polished HTML template ships with this skill at `/plugin/data-validator/references/report-template.html`. **Use it when it is readable.** It carries `<!-- SLOT:name -->...<!-- /SLOT:name -->` and `<!-- BLOCK:name -->...<!-- /BLOCK:name -->` markers that map onto the data you already compute below. Filling those markers gives the cleanest, run-to-run-stable report.

When the template is absent or you cannot fill its slots reliably, **fall back to generating the report organically** following the section spec in Step 4. The fallback report MUST still include the banner, header, heatmap (when findings exist), and top-findings list — there is no "minimal banner only" mode. Both paths are equally acceptable; the goal is a useful report, not a deterministic byte-for-byte match.

The companion file `/plugin/data-validator/references/report-style.md` documents the editorial + visual contract (palette, typography, tone, iframe constraints). Read it once to internalise the style, then apply it whether you go template-path or organic-path.

## Workflow

### Step 1 — Read inputs

1. Find the **`## Input Data`** section in the prompt and parse the JSON. This is your authoritative source for classification + summary fields.
2. Read `/workspace/findings.json` for the raw engine rows. If the file is missing or unparseable, degrade gracefully (heatmap and top-findings will become empty / omitted) but still write a useful report.
3. Attempt to read `/plugin/data-validator/references/report-template.html`. If readable, keep it as a string — you will use it in Step 4. If unreadable, note that you will go organic in Step 4. Either way, continue.

### Step 2 — Read the deterministic classification

The classification is **already computed**. Read these fields from the prompt's Input Data and use them as-is:

- `classification` — one of `clean`, `minor-fix`, `recovery`, `escalate`, `chaos`. Echo verbatim in `result.json`. Do **not** recompute it from the findings.
- `classificationReason` — 1–2 sentence text. Echo verbatim in `result.summary`.
- `scriptFailedFlag` — boolean. Echo verbatim in `result.scriptFailedFlag`.
- `summary` — alias of `classificationReason`. Use whichever is non-empty.

The five classes are the v0.1 product spec and the only allowed values. The router enforces them. Do not invent new labels and do not "upgrade" a class based on the findings — if the script chose `recovery` for a single critical-structure domain and the findings look bad, still emit `recovery`. Determinism is the point.

### Step 3 — Build the heatmap and top-findings rows (presentation only)

Read `/workspace/findings.json` and build:

- **Domain × Category heatmap** — rows = SDTM domains present in `Issue_Summary`, columns = the rule categories from `references/cdisc-categories.md` (Structure / Controlled Terminology / Consistency / FDA Business Rules / PMDA / Other), cells = sum of `issues` per `(domain, category)` pair.
- **Top findings list** — top 20 rows from `Issue_Summary` sorted by `issues` descending, then by domain. Each row carries: rule code (`rule_id` or `core_id`), domain (`dataset`), severity, brief `message` (truncate to ~200 chars).
- **Overflow note** — if `Issue_Summary.length > 20`, the string `+ N more findings — see /workspace/findings.json for full set` (N = total rows minus 20). Else empty.
- **Severity totals** — sum `issues` per severity bucket (Critical / Major / Minor / Warning), ignoring rows with missing or unknown severity.
- **Dataset count** — distinct `dataset` values in `Issue_Summary`.

Use the prefix-to-category mapping from `references/cdisc-categories.md`. The router uses the same mapping internally; the skill must mirror it for visual consistency.

### Step 4 — Render the HTML report

**If the template was readable in Step 1**, fill it. The template documents each slot with a comment in-place; the canonical sources are:

| Slot | Value |
|------|-------|
| `study_id` | `input.variables.STUDY_ID` or `STUDY_ID` env. Fall back to `"unknown"`. |
| `header_study_id` | Same value as `study_id`. |
| `delivery_id` | Basename of `input.deliveryDir`. Fall back to `"unknown"`. |
| `generated_at` | Current UTC time, ISO 8601 (`YYYY-MM-DDTHH:MM:SSZ`). |
| `rules_commit` | First 7 chars of `input.variables.RULES_COMMIT` if present, else `"–"`. |
| `total_findings` | `input.findingsCount` formatted as integer. |
| `count_critical` | Severity total for "Critical" from Step 3. |
| `count_major` | Severity total for "Major" from Step 3. |
| `count_minor` | Severity total for "Minor" from Step 3. |
| `count_warning` | Severity total for "Warning" from Step 3. |
| `dataset_count` | Distinct datasets from Step 3. |
| `dataset_coverage` | One-line plain-text summary comparing `EXPECTED_DOMAINS` (env, comma-separated) against the distinct datasets in `Issue_Summary`. Format: `Expected DM, AE, LB, EX, VS, MH, CM — delivered DM, AE, LB. Missing: EX, VS, MH, CM.` If `EXPECTED_DOMAINS` is unset, render `Expected domains not configured for this study.` HTML-escape the values. |
| `status_banner` | EXACT HTML block from the canonical-copy table below — pick by `classification`. |
| `classification_explainer` | EXACT paragraph from the canonical-copy table below — pick by `classification`. |
| `heatmap_rows` | One `<tr>` per domain present, in alphabetical order. Cells with count = 0 use class `heat-0`. Cells 1–4 use `heat-1`, 5–19 `heat-2`, 20+ `heat-3`. |
| `findings_rows` | One `<tr>` per top finding. Severity rendered as `<span class="badge severity-{class}">{label}</span>`. |
| `findings_overflow_note` | The overflow string from Step 3, or empty. |
| `failure_error` | `input.error` (script-failed path only). |
| `failure_traceback` | `input.traceback` (script-failed path only). HTML-escape `<`, `>`, `&`. |
| `footer_timestamp` | Same as `generated_at`. |
| `footer_rules_commit` | Same as `rules_commit`. |
| `footer_total_findings` | Same as `total_findings`. |

For `<!-- BLOCK:name -->...<!-- /BLOCK:name -->` markers, either keep the block (and fill slots inside) or remove the entire block (including the marker comments) when its data is absent:

- `BLOCK:heatmap`: keep if `findingsCount > 0`, otherwise remove the whole block.
- `BLOCK:top_findings`: keep if `findingsCount > 0`, otherwise remove the whole block.
- `BLOCK:failure_detail`: keep if `scriptFailedFlag = true`, otherwise remove the whole block.

HTML-escape all user-controlled text (messages, rule codes, dataset names) you substitute into slot contents.

**If the template was NOT readable in Step 1**, generate the HTML organically. Required sections, in order:

1. **Status banner** — full-width, top of page. Colour and text are driven by `classification`:

   | Classification | Banner classes              | Banner text                                                                       |
   |----------------|-----------------------------|-----------------------------------------------------------------------------------|
   | `clean`        | `bg-green-600 text-white`   | "Delivery is clean — no findings."                                                |
   | `minor-fix`    | `bg-blue-600 text-white`    | "Minor fixes — terminology drift dominates."                                      |
   | `recovery`     | `bg-amber-500 text-white`   | "Single-domain critical structure issue — recoverable."                           |
   | `escalate`     | `bg-red-600 text-white`     | "Multi-domain critical structure failure — cannot ingest."                        |
   | `chaos`        | `bg-zinc-900 text-white`    | "Validation could not complete (script failure or pervasive structure errors)."   |

   Below the headline, render the `classificationReason` (1–2 sentence text from input). When `scriptFailedFlag = true`, include a `<details>` block holding the traceback.

2. **Header** — study ID, delivery ID, generated-at timestamp, total findings count.

3. **Severity metrics** — Critical / Major / Minor / Warning counts from Step 3, plus dataset count and a one-line coverage summary as described under the `dataset_coverage` slot above.

4. **Classification explainer paragraph** — use the canonical copy from the table further below (same text the template uses).

5. **Severity heatmap** — only when `findingsCount > 0`. Rows = SDTM domains present, columns = CDISC rule categories. Empty cells render blank; non-zero cells use a colour scale (light amber for 1–4, deeper amber for 5–19, red for 20+).

6. **Top findings list** — only when `findingsCount > 0`. Show the top 20 from Step 3. Append the overflow note when present.

7. **Failure detail** — only when `scriptFailedFlag = true`. The traceback inside a collapsible `<details>`. The heatmap and findings list are still rendered when raw findings exist (partial mid-run output) — show whatever signal is available without overstating it.

In the organic path, use the Tailwind utility classes the iframe already loads via CDN. No `<style>` blocks beyond what is strictly necessary for the heatmap colour scale. No external scripts, no fetch calls. The iframe is sandboxed — relative URLs do not resolve.

The reviewer is a human data manager. Plain English, no marketing tone. Show counts, codes, domains, messages — not adjectives.

### Step 5 — Write `/output/result.json`

```json
{
  "classification": "clean" | "minor-fix" | "recovery" | "escalate" | "chaos",
  "classificationReason": "echoed from input",
  "summary": "echoed from input (alias of classificationReason)",
  "htmlReportPath": "/output/presentation.html",
  "scriptFailedFlag": true | false
}
```

`htmlReportPath` is always `/output/presentation.html` when an HTML report was written. In v0.1 always write the HTML, regardless of which path you took in Step 4.

## Canonical banner + explainer copy

These are the only allowed values for the status banner HTML (template path) and the classification explainer paragraph (both paths). Copy them verbatim. Do not rephrase, summarise, or extend.

### `clean`

**Status banner HTML (template-path slot value):**

```html
<div class="rounded-xl px-6 py-5 bg-emerald-600 text-white">
  <div class="text-xs font-semibold uppercase tracking-wider opacity-80">Classification</div>
  <div class="text-2xl font-semibold mt-1">Clean — no findings</div>
  <p class="mt-2 text-sm opacity-90">{{classificationReason}}</p>
</div>
```

**Explainer paragraph (both paths):**

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

In the template-path banner blocks, `{{classificationReason}}` is the only string the skill substitutes — replace it with `input.classificationReason` (HTML-escaped). Everything else is fixed.

## Constraints

- **Do not classify.** The 5-class verdict is computed by the deterministic Python router in `validate-script` and arrives in the prompt's Input Data. Echo it; do not recompute it. This is a pharma compliance / reproducibility / cost requirement — LLM output cannot drive automated routing.
- Do not call out to external services. Do not run `cdisc-rules-engine` yourself — that is the previous step's job.
- Do not modify `/workspace/findings.json`. It is the audit record.
- Do not invent findings, severities, or rule codes. If the data does not contain a field, omit the field; do not synthesise.
- Do not include study-specific or CRO-specific text in the HTML — pull names from the input / env. The skill must work for any landing-zone study with the same inputs.
- Do not paraphrase the canonical banner or explainer copy. Copy verbatim.
- All text in English.

## Edge cases

- **`classification` is missing from input** — fall back to `chaos`, render the chaos banner, and surface the missing-classification fact in the failure-detail section. This should never happen in production.
- **`/workspace/findings.json` is unreadable** — still render the banner, header, key metrics (showing `0` where computation requires findings), and explainer. Omit the heatmap and top-findings sections (template path: remove their BLOCKs; organic path: skip those sections). Add a one-line note inside the failure-detail block describing the missing file.
- **Template is missing or unfillable** — go organic. Do NOT produce a minimal banner-only report; emit the full organic version with all required sections present. Report confidence stays high — this is a normal fallback path, not a failure.
- **Raw findings array very large (>1000 rows)** — heatmap shows full counts; top-findings list truncates to 20 with the overflow note.
- **`scriptStatus = ok` but `error` field is set** — render the failure-detail block alongside the heatmap. Banner is driven by classification, not the error field.
- **No `deliveryId` in input** — fall back to the directory basename of `deliveryDir`. If neither, label `"unknown"`.

## Reference files

- `references/cdisc-categories.md` — CDISC rule categories (Structure / Controlled Terminology / Consistency / FDA Business Rules / PMDA), severity levels (Critical / Major / Minor / Warning), and the rule-code prefix conventions used to map findings into categories. Read this before building the heatmap in Step 3. The same prefix mapping is applied internally by the Python router that assigned the classification.
- `/plugin/data-validator/references/report-template.html` — optional polished HTML template with `<!-- SLOT:name -->` and `<!-- BLOCK:name -->` markers. Use it when readable for the cleanest, run-to-run-stable report. The skill is allowed to fall back to organic generation if the template is missing or any slot fill fails.
- `/plugin/data-validator/references/report-style.md` — editorial and visual contract. Read once to internalise the tone and visual identity, then apply it whether template-path or organic-path is taken.

Template, style guide, and skill logic ship and version together — change them in the same commit when slot or block markers are added, renamed, or removed.
