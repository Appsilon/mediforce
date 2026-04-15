---
name: generate-council-summary
description: Aggregate approved package assessments into a structured council meeting summary with consent agenda, action items, and renewal assessments
---

# Generate Council Summary

You are given the package assessment results from the pharmaverse governance review. Your job is to aggregate them into a structured council meeting document with both machine-readable JSON and a polished HTML presentation.

## Task

Produce two output files:

1. **`/output/result.json`** — Structured JSON for downstream consumption
2. **`/output/presentation.html`** — A polished, readable HTML report for the governance lead to review

## Input

Check all files in `/output/` to understand what data is available:

- **First run**: Input comes from the `assess-packages` step — contains `assessments` array with per-package governance assessments.
- **Revision run**: Input includes `verdict: "revise"` and a `comment` field with council decisions/feedback. You MUST incorporate these decisions into the report. Previous assessment data is available in `/output/` files from prior steps.

When processing a revision:
1. Parse the council's comment for specific decisions (e.g., "admiral status approved", "rhino — option A selected")
2. Update the report to reflect resolved decisions
3. Mark resolved items as decided and remove them from pending action items
4. If all blocking action items are resolved, the report should clearly state "All blocking items resolved — ready for final approval"

## Output 1: result.json

Write a JSON file to `/output/result.json` with this structure:

```json
{
  "output_file": "/output/result.json",
  "summary": "Council summary: N packages reviewed, X decisions pending, Y resolved",
  "councilSummary": {
    "title": "Pharmaverse Semiannual Governance Review — {Month Year}",
    "reviewDate": "YYYY-MM-DD",
    "overview": {
      "totalPackages": 0,
      "consentAgendaCount": 0,
      "proposedChangesCount": 0,
      "renewalsDueCount": 0,
      "earlyWarningsCount": 0,
      "pendingDecisions": 0,
      "resolvedDecisions": 0
    },
    "consentAgenda": [],
    "proposedChanges": [],
    "renewalAssessments": [],
    "earlyWarnings": [],
    "actionItems": [],
    "councilDecisions": []
  }
}
```

## Output 2: presentation.html

Write a self-contained HTML file to `/output/presentation.html`. This file is rendered in a sandboxed iframe within the Mediforce review UI.

**CRITICAL: The HTML structure below is a strict template. Follow it exactly. Do NOT improvise sections, reorder them, or add new sections. Populate the template with data from the assessments.**

### Exact Section Order

The report MUST contain these sections in this exact order:

1. **Title** — `<h1>` with review title and date
2. **Governance Criteria Reference** — collapsed `<details>`, as specified in the CSS/HTML below
3. **Overview Stats** — grid of stat cards
4. **Council Decisions** — only shown after first revision
5. **Proposed Changes** — one `<details>` per package, each collapsed by default
6. **Early Warnings** — collapsed `<details>`
7. **Pending Action Items** — three categories: blocking pre-checks, meeting decisions, post-approval actions

### HTML Template

You MUST use this exact HTML structure and CSS. Only fill in the data placeholders.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&family=Raleway:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Raleway', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; background: #fff; padding: 1.5rem; max-width: 900px; margin: 0 auto; line-height: 1.6; font-size: 14px; font-weight: 400; }
    h1, h2, h3 { font-family: 'Montserrat', 'Raleway', sans-serif; }
    h1 { font-size: 1.5rem; font-weight: 700; color: #212529; border-bottom: 3px solid #ff0043; padding-bottom: 0.5rem; margin: 0 0 1.25rem 0; }
    h2 { font-size: 1.1rem; font-weight: 600; color: #444; margin: 1.5rem 0 0.5rem 0; }

    /* Stat cards — fixed 6-column grid, pharmaverse card style */
    .stats { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0.5rem; margin-bottom: 1.25rem; }
    .stat { background: #f8f9fa; border: 1px solid rgba(0,0,0,0.125); border-radius: 0.25rem; padding: 0.6rem 0.4rem; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .stat.green { background: #ecfdf5; border-color: #a7f3d0; }
    .stat.amber { background: #fffbeb; border-color: #fde68a; }
    .stat.red { background: #fef2f2; border-color: #fecaca; }
    .stat-n { font-family: 'Montserrat', sans-serif; font-size: 1.6rem; font-weight: 700; line-height: 1.2; }
    .stat-l { font-size: 0.6rem; color: #6c757d; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.15rem; }

    /* Collapsible */
    details { border: 1px solid rgba(0,0,0,0.125); border-radius: 0.25rem; margin: 0.6rem 0; overflow: hidden; }
    summary { padding: 0.6rem 0.85rem; cursor: pointer; font-family: 'Montserrat', sans-serif; font-weight: 600; font-size: 0.9rem; background: #f8f9fa; user-select: none; list-style: none; display: flex; align-items: center; gap: 0.5rem; }
    summary::-webkit-details-marker { display: none; }
    summary::before { content: '▶'; font-size: 0.6rem; color: #6c757d; transition: transform 0.15s; flex-shrink: 0; }
    details[open] > summary::before { transform: rotate(90deg); }
    summary:hover { background: #f5f5f5; }
    .det-body { padding: 0.6rem 0.85rem; }
    details.ref { border-color: #dee2e6; border-left: 3px solid #ff0043; }
    details.ref > summary { background: #f7f7f7; font-size: 0.8rem; color: #444; }

    /* Badges — pharmaverse palette, strong saturation */
    .b { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 0.25rem; font-size: 0.65rem; font-weight: 700; vertical-align: middle; white-space: nowrap; font-family: 'Montserrat', sans-serif; letter-spacing: 0.02em; }
    .b-stable { background: #22c55e; color: #fff; }
    .b-maturing { background: #3b82f6; color: #fff; }
    .b-watch { background: #f59e0b; color: #fff; }
    .b-atrisk { background: #ef4444; color: #fff; }
    .b-archived { background: #6b7280; color: #fff; }
    .b-ok { background: #22c55e; color: #fff; }
    .b-warn { background: #f59e0b; color: #fff; }
    .b-fail { background: #ef4444; color: #fff; }
    .b-na { background: #d1d5db; color: #6b7280; }
    .b-decided { background: #22c55e; color: #fff; }
    .b-pending { background: #f59e0b; color: #fff; }
    .cnt { background: #e5e7eb; color: #374151; font-size: 0.65rem; font-weight: 600; padding: 0.05rem 0.4rem; border-radius: 0.25rem; margin-left: auto; font-family: 'Montserrat', sans-serif; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; font-size: 0.82rem; margin: 0.4rem 0; }
    th { text-align: left; padding: 0.35rem 0.5rem; background: #f8f9fa; border-bottom: 2px solid #dee2e6; font-weight: 600; color: #495057; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.03em; }
    td { padding: 0.35rem 0.5rem; border-bottom: 1px solid #f5f5f5; }
    tr:hover td { background: #f8f9fa; }

    /* Package header in proposed changes */
    .pkg-header { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    .pkg-badges { display: flex; gap: 0.3rem; flex-wrap: wrap; }
    .badge-col-labels { display: flex; gap: 0.3rem; font-size: 0.55rem; color: #6c757d; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 0.15rem; font-family: 'Montserrat', sans-serif; }
    .badge-col-labels span { min-width: 4.5rem; text-align: center; }

    /* Package detail status borders — add class to <details> for colored left accent */
    details.status-stable { border-left: 4px solid #22c55e; }
    details.status-maturing { border-left: 4px solid #3b82f6; }
    details.status-watch { border-left: 4px solid #f59e0b; }
    details.status-atrisk { border-left: 4px solid #ef4444; }
    details.status-archived { border-left: 4px solid #6b7280; }

    /* Evidence & recommendations */
    .ev { font-size: 0.8rem; color: #495057; margin: 0.4rem 0; }
    .ev strong { color: #212529; }
    .cc { font-family: 'SFMono-Regular', Menlo, monospace; font-size: 0.68rem; background: #f7f7f7; padding: 0.08rem 0.3rem; border-radius: 0.2rem; color: #495057; border: 1px solid #dee2e6; }
    .rec { border-left: 4px solid #22c55e; padding: 0.5rem 0.75rem; margin: 0.5rem 0; font-size: 0.82rem; border-radius: 0 0.25rem 0.25rem 0; background: #ecfdf5; font-weight: 500; }
    .rec.caution { background: #fffbeb; border-left-color: #f59e0b; }
    .rec.alert { background: #fef2f2; border-left-color: #ef4444; }
    .dec-box { background: #ecfdf5; border: 2px solid #22c55e; border-radius: 0.25rem; padding: 0.6rem 0.85rem; margin: 0.4rem 0; }
    .dec-label { font-size: 0.65rem; text-transform: uppercase; color: #16a34a; font-weight: 700; letter-spacing: 0.05em; font-family: 'Montserrat', sans-serif; }

    /* Action items */
    .actions-group { margin: 0.5rem 0; }
    .actions-group h3 { font-family: 'Montserrat', sans-serif; font-size: 0.85rem; font-weight: 600; margin: 0.75rem 0 0.25rem 0; color: #444; }
    .actions-group h3 .icon { margin-right: 0.25rem; }
    .action { padding: 0.3rem 0; font-size: 0.82rem; border-bottom: 1px solid #f5f5f5; }
    .action:last-child { border-bottom: none; }
    .all-clear { background: #d4edda; border: 1px solid #c3e6cb; border-radius: 0.25rem; padding: 0.6rem 0.85rem; font-size: 0.85rem; color: #155724; font-weight: 500; }

    /* Links — pharmaverse blue */
    a { color: #007bff; text-decoration: none; }
    a:hover { color: #0069d9; text-decoration: underline; }
    .divider { border: none; border-top: 1px solid #dee2e6; margin: 1.25rem 0; }
    .muted { color: #6c757d; font-style: italic; font-size: 0.82rem; }

    /* Dark mode */
    @media (prefers-color-scheme: dark) {
      body { color: #dee2e6; background: #1a1a2e; }
      h1 { color: #f8f9fa; border-bottom-color: #ff0043; }
      h2, .actions-group h3 { color: #dee2e6; }
      .stat, summary { background: #2a2a3e; border-color: #3a3a4e; }
      .stat.green { background: #0a2a1a; border-color: #22c55e; }
      .stat.amber { background: #2a2000; border-color: #f59e0b; }
      .stat.red { background: #2a0a0a; border-color: #ef4444; }
      .stat-l { color: #adb5bd; }
      details { border-color: #3a3a4e; }
      details.ref { border-left-color: #ff0043; }
      details.status-stable { border-left-color: #22c55e; }
      details.status-maturing { border-left-color: #3b82f6; }
      details.status-watch { border-left-color: #f59e0b; }
      details.status-atrisk { border-left-color: #ef4444; }
      summary:hover { background: #3a3a4e; }
      th { background: #2a2a3e; color: #adb5bd; border-color: #3a3a4e; }
      td { border-color: #2a2a3e; }
      tr:hover td { background: #2a2a3e; }
      .cc { background: #2a2a3e; color: #adb5bd; border-color: #3a3a4e; }
      .ev { color: #adb5bd; } .ev strong { color: #f8f9fa; }
      .rec { background: #0a2a1a; border-left-color: #22c55e; }
      .rec.caution { background: #2a2000; border-left-color: #f59e0b; }
      .rec.alert { background: #2a0a0a; border-left-color: #ef4444; }
      .dec-box { background: #0a2a1a; border-color: #22c55e; }
      a { color: #3bbfe4; }
      a:hover { color: #6dd5f0; }
      .divider { border-color: #3a3a4e; }
      .cnt { background: #3a3a4e; color: #adb5bd; }
      .all-clear { background: #0a2a1a; border-color: #22c55e; color: #34ce57; }
    }
  </style>
</head>
<body>

<!-- ===== 1. TITLE ===== -->
<h1>Pharmaverse Semiannual Governance Review — {Month Year}</h1>

<!-- ===== 2. CRITERIA REFERENCE (always collapsed) ===== -->
<details class="ref">
  <summary>📋 Governance Criteria Reference</summary>
  <div class="det-body">
    <table>
      <tr><th>Code</th><th>Criteria</th></tr>
      <tr><td><span class="cc">ST-1..5</span></td><td>Stable: settled API, issues ≤30/90d, ≥1 release/term, badges assessed, docs current</td></tr>
      <tr><td><span class="cc">MA-1..5</span></td><td>Maturing: RFC approved, active dev, QR within 12mo target</td></tr>
      <tr><td><span class="cc">WA-1..4</span></td><td>Watch: documented concern, majority vote, 30-day appeal</td></tr>
      <tr><td><span class="cc">AR-1..5</span></td><td>At Risk: failing after ≥1 Watch quarter, remediation required</td></tr>
      <tr><td><span class="cc">AV-1..4</span></td><td>Archived: endorsement withdrawn</td></tr>
    </table>
    <table>
      <tr><th>Code</th><th>Quality Badge</th></tr>
      <tr><td><span class="cc">SS-1..4</span></td><td>Submission-Suitable: validation, CDISC, stability, regulatory</td></tr>
      <tr><td><span class="cc">SC-1..3</span></td><td>Submission-Caution: unvalidated, dependency risks, grey areas</td></tr>
      <tr><td><span class="cc">AM-1..5</span></td><td>Actively Maintained: issues ≤30/90d, releases, deprecation notice, docs</td></tr>
      <tr><td><span class="cc">LM-1..4</span></td><td>Low Maintenance: thresholds exceeded, no releases, unresponsive</td></tr>
      <tr><td><span class="cc">QR-0..4</span></td><td>Quality Reviewed: R CMD check, coverage ≥70%, vignettes, docs</td></tr>
      <tr><td><span class="cc">RP-1..3</span></td><td>Review Pending: expected for Maturing, concern for Stable</td></tr>
    </table>
    <table>
      <tr><th>Code</th><th>Renewal Trigger</th></tr>
      <tr><td><span class="cc">RT-1</span></td><td>18-month calendar limit</td></tr>
      <tr><td><span class="cc">RT-2</span></td><td>Major version release (breaking change)</td></tr>
      <tr><td><span class="cc">RT-3</span></td><td>Council-initiated (credible concerns)</td></tr>
    </table>
  </div>
</details>

<!-- ===== 3. OVERVIEW STATS (fixed 6-col grid, never wraps) ===== -->
<div class="stats">
  <div class="stat"><div class="stat-n">{N}</div><div class="stat-l">Packages</div></div>
  <div class="stat green"><div class="stat-n" style="color:#16a34a">{N}</div><div class="stat-l">Consent</div></div>
  <div class="stat amber"><div class="stat-n" style="color:#d97706">{N}</div><div class="stat-l">Changes</div></div>
  <div class="stat red"><div class="stat-n" style="color:#dc2626">{N}</div><div class="stat-l">Warnings</div></div>
  <div class="stat green"><div class="stat-n" style="color:#16a34a">{N}</div><div class="stat-l">Resolved</div></div>
  <div class="stat amber"><div class="stat-n" style="color:#d97706">{N}</div><div class="stat-l">Pending</div></div>
</div>

<!-- ===== 4. COUNCIL DECISIONS (only after first revision) ===== -->
<!-- If no revisions yet, omit this section entirely. -->
<!-- If revisions have been made, show each decision: -->
<!--
<h2>Council Decisions</h2>
<div class="dec-box">
  <div class="dec-label">Decision</div>
  <p>{packageName}: {decision text}</p>
</div>
-->

<!-- ===== 5. PROPOSED CHANGES ===== -->
<!-- Column labels row — always show above the first package -->
<h2>Proposed Changes</h2>

<!-- If none: -->
<!-- <p class="muted">No changes proposed this cycle.</p> -->

<!-- For each package, one <details> block, COLLAPSED by default. -->
<!-- Add status-{class} to <details> for colored left border: status-stable, status-maturing, status-watch, status-atrisk, status-archived -->
<!--
<details class="status-{statusClass}">
  <summary>
    <span class="pkg-header">
      <a href="{repoUrl}" target="_blank">{packageName}</a>
      <span class="b b-{statusClass}">{proposed status}</span>
      →
      <span class="pkg-badges">
        <span class="b b-{ok|warn|fail|na}" title="Submission Readiness">{badge}</span>
        <span class="b b-{ok|warn|fail|na}" title="Maintenance Health">{badge}</span>
        <span class="b b-{ok|warn|fail|na}" title="Technical Quality">{badge}</span>
      </span>
    </span>
    <span class="b b-pending">Pending</span>
    OR
    <span class="b b-decided">Decided</span>
  </summary>
  <div class="det-body">

    ALWAYS include a badge legend row at the top of each package body:
    <div class="badge-col-labels">
      <span>Submission</span><span>Maintenance</span><span>Quality</span>
    </div>

    Then: evidence, status criteria table, proposed badge assignments.

    Maintenance details table (if available — always include, collapsed):
    <details>
      <summary>Maintenance Details</summary>
      <div class="det-body">
        <table>releases, issues, PRs, response times, etc.</table>
      </div>
    </details>

    Recommendation:
    <div class="rec caution">
      <strong>Recommendation:</strong> {action}
    </div>

    Do NOT include "council judgement" or "data flags" sections.
    Keep it to: evidence → criteria table → badges → maintenance details (collapsed) → recommendation.
  </div>
</details>
-->

<hr class="divider">

<!-- ===== 6. EARLY WARNINGS (collapsed) ===== -->
<details>
  <summary>Early Warnings <span class="cnt">{N}</span></summary>
  <div class="det-body">
    <!-- table or list of warnings. If none: <p class="muted">None.</p> -->
  </div>
</details>

<hr class="divider">

<!-- ===== 7. ACTION ITEMS — three categories ===== -->
<h2>Action Items</h2>

<!-- Category A: Pre-decision checks (blocking — must be resolved before council can decide) -->
<div class="actions-group">
  <h3><span class="icon">🔍</span> Pre-Decision Checks</h3>
  <!-- Things like "verify CRAN status for X", "confirm coverage numbers for Y" -->
  <!-- If none: <p class="muted">None — all data verified.</p> -->
  <div class="action">• {description}</div>
</div>

<!-- Category B: Meeting decisions (blocking — council votes needed before approval) -->
<div class="actions-group">
  <h3><span class="icon">🗳️</span> Decisions Required</h3>
  <!-- Things like "Vote on Watch designation for X", "Approve renewal for Y" -->
  <!-- If none: <p class="muted">None — all decisions made.</p> -->
  <div class="action">• {description} — <em>{vote threshold}</em></div>
</div>

<!-- Category C: Post-approval actions (non-blocking — happen after report is approved) -->
<div class="actions-group">
  <h3><span class="icon">📬</span> Post-Approval Actions</h3>
  <!-- Things like "Notify maintainer of X", "Schedule follow-up review for Y" -->
  <!-- If none: <p class="muted">None.</p> -->
  <div class="action">• {description}</div>
</div>

<!-- If ALL categories A and B are empty: -->
<!-- <div class="all-clear">✓ All blocking items resolved — ready for final approval.</div> -->

</body>
</html>
```

### Strict Rules

1. **Use the CSS classes exactly as defined.** Do not invent new CSS classes or inline styles beyond what's in the template.
2. **Stat cards are always a 6-column grid.** The CSS `.stats` uses `grid-template-columns: repeat(6, 1fr)`. This prevents wrapping. Do not change the grid.
3. **Every `<details>` for a proposed change is COLLAPSED by default** (no `open` attribute). The user expands what they want to read.
4. **Each package's badge row must have column labels** above it using `.badge-col-labels`: Submission, Maintenance, Quality. This makes the colored badges understandable.
5. **Maintenance details** table (releases, issues, PRs, response times) is always present inside each package but wrapped in a nested collapsed `<details>`. This keeps the main view clean.
6. **Do NOT include** sections called "Council Judgement", "Data Flags", "Data Quality Notes", or similar. If there are data gaps, note them briefly in the evidence section with "⚠ {metric}: data unavailable".
7. **Action items have exactly three categories** as specified. Classify each action into the correct category. Pre-decision checks and meeting decisions are blocking (must be resolved before approval). Post-approval actions are non-blocking.
8. **The "All blocking items resolved" banner** only appears when categories A and B are both empty.

### Handling Revision Cycles

When the input contains `verdict: "revise"` and a `comment`:

1. Parse the comment for decisions
2. Move decided items: change their badge from `b-pending` to `b-decided`, collapse their `<details>`
3. Remove resolved items from action items categories A and B
4. Add decisions to the Council Decisions section
5. Update overview stat counts

## Rules

- Keep language neutral and evidence-based
- If data collection had errors, note briefly in evidence: "⚠ {metric}: collection failed"
- Always show section headers even when empty (with `<p class="muted">None.</p>`)
- HTML must be fully self-contained (no external resources)
- Keep under 200KB
