---
name: data-validator
description: "Render a self-contained HTML report for a CDISC CORE validation delivery. The 5-class classification (clean / minor-fix / recovery / escalate / chaos) is computed deterministically by the prior validate-script step — this skill reads it from input.json and presents it. Use this skill when the prior step has produced findings or has failed and the task is to render the report a human reviewer (or downstream auto-route) will read. Triggers: 'interpret validation', 'render validation report', 'review CDISC CORE output', 'validation report for human review', 'landing zone interpret'. This skill is the agent half of the validate -> human-review handoff."
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

The container has two read paths:

- **`/output/input.json`** — the engine-provided step input. Contains the `validate-script` step output under the standard step-output shape:
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

Do not assume the structure of an individual finding beyond the fields documented in `references/cdisc-categories.md`. The CORE engine emits arrays of objects; field names of interest typically include `rule_id` (or `core_id`), `dataset` (the domain), `severity`, `message`, and an issue count. Field names can vary across CORE versions — read defensively and degrade gracefully when an expected field is absent.

## Workflow

### Step 1 — Read inputs

Read `/output/input.json` first. Then read `/workspace/findings.json` for the raw engine rows. If either read fails, surface the failure prominently in the HTML and write `result.json` echoing whatever classification the input contained (or `chaos` if input is unreadable). Do not synthesise a classification.

### Step 2 — Read the deterministic classification

The classification is **already computed**. Read these fields from `/output/input.json` and use them as-is:

- `classification` — one of `clean`, `minor-fix`, `recovery`, `escalate`, `chaos`. Echo this verbatim in `result.json`. Do **not** recompute it from the findings.
- `classificationReason` — 1–2 sentence text explaining which rule fired. Echo this verbatim in `result.summary`.
- `scriptFailedFlag` — boolean. Echo verbatim in `result.scriptFailedFlag`.
- `summary` — alias of `classificationReason`. Use whichever is non-empty.

The five classes are the v0.1 product spec and the only allowed values. The router enforces them. Do not invent new labels and do not "upgrade" a class based on the findings — if the script chose `recovery` for a single critical-structure domain and the findings look bad, still emit `recovery`. Determinism is the point.

### Step 3 — Build the heatmap and top-findings rows (presentation only)

The classification is settled, but the report still needs the visual breakdown. Read `/workspace/findings.json` and build:

- **Domain × Category heatmap** — rows = SDTM domains present in `Issue_Summary`, columns = the rule categories from `references/cdisc-categories.md` (Structure / Controlled Terminology / Consistency / FDA Business Rules / PMDA / Other), cells = sum of `issues` per `(domain, category)` pair.
- **Top findings list** — top 20 rows from `Issue_Summary` sorted by `issues` descending, then by domain. Each row shows: rule code (`rule_id` or `core_id`), domain (`dataset`), severity badge, brief `message` (truncate to ~200 chars).

Use the prefix-to-category mapping from `references/cdisc-categories.md`. The router uses the same mapping internally; the skill must mirror it for visual consistency.

### Step 4 — Render the HTML report

Write `/output/presentation.html`. The host iframe loads Tailwind v4 via CDN and exposes the result JSON as `window.__data__`. You can rely on Tailwind utility classes; do not re-import Tailwind.

Required sections, in order:

1. **Status banner** — full-width, top of page. Colour and text are driven by `classification`:

   | Classification | Banner classes              | Banner text                                                                       |
   |----------------|-----------------------------|-----------------------------------------------------------------------------------|
   | `clean`        | `bg-green-600 text-white`   | "Delivery is clean — no findings."                                                |
   | `minor-fix`    | `bg-blue-600 text-white`    | "Minor fixes — terminology drift dominates."                                      |
   | `recovery`     | `bg-amber-500 text-white`   | "Single-domain critical structure issue — recoverable."                           |
   | `escalate`     | `bg-red-600 text-white`     | "Multi-domain critical structure failure — cannot ingest."                        |
   | `chaos`        | `bg-zinc-900 text-white`    | "Validation could not complete (script failure or pervasive structure errors)."   |

   Below the headline, render the `classificationReason` (1–2 sentence text from input). When `scriptFailedFlag = true`, also include a `<details>` block holding the traceback.

2. **Header** — delivery ID (from `deliveryDir` basename), study ID (read from `STUDY_ID` env if available, otherwise from `input.json.variables`), timestamp, total findings count.

3. **Severity heatmap** — only when `findingsCount > 0`. A simple HTML table: rows = SDTM domains present in the findings, columns = the rule categories from `references/cdisc-categories.md`, cells = counts. Empty cells render blank, non-zero cells use a colour scale (light amber for 1–4, deeper amber for 5–19, red for 20+). Add a small legend.

4. **Top findings list** — only when `findingsCount > 0`. Show the top 20 findings sorted by `issues` descending then by domain. For each: rule code, domain, severity badge, brief message. If `findingsCount > 20` (or `Issue_Summary.length > 20`), add a footer line "+ N more findings — see /workspace/findings.json for full set."

5. **Failure detail** — only when `scriptFailedFlag = true`. The traceback inside a collapsible `<details>`. The heatmap and findings list are still rendered when raw findings exist (e.g., script failed mid-run with partial output) — show whatever signal is available without overstating it.

Keep the HTML self-contained. No external scripts. No fetch calls. The iframe is sandboxed; relative URLs do not resolve. Use only Tailwind utility classes — no `<style>` blocks beyond what is strictly necessary for the heatmap colour scale.

The reviewer is a human data manager. Use plain English, no marketing tone. Show counts, codes, domains, messages — not adjectives.

### Step 5 — Write `/output/result.json`

Exact shape — every field is echoed from input, except `htmlReportPath`:

```json
{
  "classification": "clean" | "minor-fix" | "recovery" | "escalate" | "chaos",
  "classificationReason": "echoed from input",
  "summary": "echoed from input (alias of classificationReason)",
  "htmlReportPath": "/output/presentation.html",
  "scriptFailedFlag": true | false
}
```

`htmlReportPath` is always `/output/presentation.html` when an HTML report was written. Omit the field if (and only if) you somehow could not write the HTML — but in v0.1 always write the HTML, even for the chaos path.

## Constraints

- **Do not classify.** The 5-class verdict is computed by the deterministic Python router in `validate-script` and arrives in `input.json`. Echo it; do not recompute it. This is a pharma compliance / reproducibility / cost requirement — LLM output cannot drive automated routing.
- Do not call out to external services. Do not run `cdisc-rules-engine` yourself — that is the previous step's job.
- Do not modify `/workspace/findings.json`. It is the audit record.
- Do not invent findings, severities, or rule codes. If the data does not contain a field, omit the field; do not synthesise.
- Do not include study-specific or CRO-specific text in the HTML — pull names from `input.json` / env. The skill must work for any landing-zone study with the same inputs.
- All text in English.

## Edge cases

- **`classification` is missing from input** — fall back to `chaos` and surface the missing-classification fact in the banner. This should never happen in production (the Python router always emits one) but treat it as a script-integrity signal if it does.
- **`/workspace/findings.json` is unreadable** — still render the banner with the input's classification + reason. Skip the heatmap and top-findings sections; note the missing audit file in the failure-detail section.
- **Raw findings array is very large (>1000 rows)** — still write the full count to the heatmap, but truncate the top-findings list to 20 with a "+ N more" footer.
- **`scriptStatus = ok` but `error` field is set** — surface the error as a note in the HTML alongside the otherwise-successful findings; the classification still wins the banner.
- **No `deliveryId` in input** — fall back to the directory basename of `deliveryDir`. If neither is present, label the delivery `unknown` and add a note next to the header.

## Reference files

- `references/cdisc-categories.md` — CDISC rule categories (Structure / Controlled Terminology / Consistency / FDA Business Rules / PMDA), severity levels (Critical / Major / Minor / Warning), and the rule-code prefix conventions used to map findings into categories. Read this before building the heatmap in Step 3. The same prefix mapping is applied internally by the Python router that assigned the classification.
