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

The input is the assessment output from the `assess-packages` step. It contains:
- `assessments` array — per-package assessment with proposed status, badges, evidence, flags
- `summary` — counts of consent agenda, proposed changes, renewals, warnings

Read the input from `/output/prev-assess-packages-packages.json` or the files available in `/output/`.

## Output 1: result.json

Write a JSON file to `/output/result.json` with this structure:

```json
{
  "output_file": "/output/result.json",
  "summary": "Council summary: N packages reviewed, X changes proposed, Y renewals due, Z warnings",
  "councilSummary": {
    "title": "Pharmaverse Semiannual Governance Review — {Month Year}",
    "reviewDate": "YYYY-MM-DD",
    "overview": {
      "totalPackages": 0,
      "consentAgendaCount": 0,
      "proposedChangesCount": 0,
      "renewalsDueCount": 0,
      "earlyWarningsCount": 0
    },
    "consentAgenda": [
      { "name": "pkg", "status": "Stable", "maintenance": "Actively Maintained", "quality": "Quality Reviewed", "submission": "Suitable" }
    ],
    "proposedChanges": [],
    "renewalAssessments": [],
    "earlyWarnings": [],
    "actionItems": []
  }
}
```

## Output 2: presentation.html

Write a self-contained HTML file to `/output/presentation.html`. This file is rendered in a sandboxed iframe within the Mediforce review UI. It has access to Tailwind CSS classes and the result data via `window.__data__`.

The HTML report must be **clear, scannable, and actionable**. Design it for a governance lead who needs to quickly understand:
- Which packages are healthy (consent agenda — minimal attention)
- Which packages need discussion and votes (proposed changes)
- What the specific evidence and recommendations are

### HTML Template

Use this structure as a starting point — adapt sections based on actual data:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; color: #1a1a2e; background: #fff; padding: 2rem; max-width: 900px; margin: 0 auto; line-height: 1.6; }
    h1 { font-size: 1.5rem; font-weight: 700; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem; margin-bottom: 1.5rem; }
    h2 { font-size: 1.15rem; font-weight: 600; color: #334155; margin-top: 2rem; margin-bottom: 0.75rem; }
    h3 { font-size: 1rem; font-weight: 600; margin-top: 1.25rem; }
    .overview-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem; margin-bottom: 2rem; }
    .stat-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; text-align: center; }
    .stat-value { font-size: 1.75rem; font-weight: 700; }
    .stat-label { font-size: 0.75rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
    .badge { display: inline-block; padding: 0.125rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 500; }
    .badge-stable { background: #dcfce7; color: #166534; }
    .badge-maturing { background: #dbeafe; color: #1e40af; }
    .badge-watch { background: #fef3c7; color: #92400e; }
    .badge-at-risk { background: #fee2e2; color: #991b1b; }
    .badge-archived { background: #f1f5f9; color: #475569; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; margin: 0.75rem 0; }
    th { text-align: left; padding: 0.5rem 0.75rem; background: #f8fafc; border-bottom: 2px solid #e2e8f0; font-weight: 600; color: #475569; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.025em; }
    td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #f1f5f9; }
    tr:hover td { background: #f8fafc; }
    .change-card { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 1rem 1.25rem; margin: 0.75rem 0; }
    .change-card.warning { background: #fef2f2; border-color: #fecaca; }
    .change-card.info { background: #eff6ff; border-color: #bfdbfe; }
    .evidence { font-size: 0.85rem; color: #475569; margin: 0.5rem 0; }
    .evidence strong { color: #1e293b; }
    .criteria-ref { font-family: monospace; font-size: 0.75rem; background: #f1f5f9; padding: 0.125rem 0.375rem; border-radius: 4px; color: #475569; }
    .action-item { display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.5rem 0; border-bottom: 1px solid #f1f5f9; }
    .action-icon { width: 1.25rem; height: 1.25rem; flex-shrink: 0; margin-top: 0.125rem; }
    .section-empty { color: #94a3b8; font-style: italic; font-size: 0.875rem; padding: 0.75rem 0; }
    .recommendation { background: #f0fdf4; border-left: 3px solid #22c55e; padding: 0.5rem 0.75rem; margin: 0.5rem 0; font-size: 0.875rem; }
    .recommendation.caution { background: #fffbeb; border-left-color: #f59e0b; }
    .recommendation.alert { background: #fef2f2; border-left-color: #ef4444; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .divider { border: none; border-top: 1px solid #e2e8f0; margin: 1.5rem 0; }
    @media (prefers-color-scheme: dark) {
      body { color: #e2e8f0; background: #0f172a; }
      h2 { color: #cbd5e1; }
      .stat-card { background: #1e293b; border-color: #334155; }
      .stat-label { color: #94a3b8; }
      th { background: #1e293b; color: #94a3b8; border-color: #334155; }
      td { border-color: #1e293b; }
      tr:hover td { background: #1e293b; }
      .change-card { background: #1c1917; border-color: #78716c; }
      .change-card.warning { background: #1c1917; border-color: #991b1b; }
      .change-card.info { background: #0c1425; border-color: #1e40af; }
      .evidence { color: #94a3b8; }
      .evidence strong { color: #e2e8f0; }
      .criteria-ref { background: #334155; color: #94a3b8; }
      .recommendation { background: #0a1f0a; }
      .recommendation.caution { background: #1a1500; }
      .recommendation.alert { background: #1a0505; }
      a { color: #60a5fa; }
      .divider { border-color: #334155; }
    }
  </style>
</head>
<body>

  <h1>{title}</h1>

  <!-- Overview stats -->
  <div class="overview-grid">
    <div class="stat-card">
      <div class="stat-value">{totalPackages}</div>
      <div class="stat-label">Packages Reviewed</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color: #16a34a;">{consentAgendaCount}</div>
      <div class="stat-label">Consent Agenda</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color: #d97706;">{proposedChangesCount}</div>
      <div class="stat-label">Changes Proposed</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color: #dc2626;">{earlyWarningsCount}</div>
      <div class="stat-label">Warnings</div>
    </div>
  </div>

  <hr class="divider">

  <!-- Section 1: Consent Agenda (compact table) -->
  <h2>Consent Agenda</h2>
  <p style="font-size: 0.85rem; color: #64748b;">Packages with no proposed changes — ratified as-is.</p>
  <table>
    <thead>
      <tr><th>Package</th><th>Status</th><th>Maintenance</th><th>Quality</th><th>Submission</th></tr>
    </thead>
    <tbody>
      <!-- One row per healthy package -->
    </tbody>
  </table>

  <hr class="divider">

  <!-- Section 2: Proposed Changes (detailed cards) -->
  <h2>Proposed Changes</h2>
  <!-- For each proposed change, use a .change-card with:
       - Package name + current → proposed status badges
       - Evidence summary with criteria refs
       - Recommendation box
  -->

  <hr class="divider">

  <!-- Section 3: Early Warnings -->
  <h2>Early Warnings</h2>
  <!-- Use .change-card.info for informational warnings -->

  <hr class="divider">

  <!-- Section 4: Action Items -->
  <h2>Action Items</h2>
  <!-- Numbered list of concrete next steps with assignees -->

</body>
</html>
```

### Presentation Design Rules

1. **Lead with numbers** — the overview grid gives the governance lead an instant picture
2. **Consent agenda is a compact table** — healthy packages get one row, not a paragraph. The table should be scannable in seconds.
3. **Proposed changes get detailed cards** — each change card shows: the package name, current → proposed status with colored badges, the specific evidence with criteria IDs in `<span class="criteria-ref">`, and a recommendation box
4. **Evidence must be quantitative** — "Critical issue response median: 45 days (threshold: 30d)" not "Issues are slow to resolve"
5. **Link to GitHub repos** where possible — `<a href="{repoUrl}" target="_blank">{packageName}</a>`
6. **Early warnings are informational** — use `.change-card.info` style, softer tone
7. **Action items are concrete** — "Vote on Watch designation for {pkg}" not "Discuss {pkg}"
8. **Use status badges** — apply `.badge-stable`, `.badge-watch`, etc. for visual scanning
9. **Dark mode support** — the CSS includes a `prefers-color-scheme: dark` media query; ensure the report looks good in both modes
10. **Keep it under 200KB** — the iframe has limited space; don't dump raw JSON into the HTML

### What NOT to include

- Don't include raw metrics dumps — those are in the JSON result
- Don't include per-package detailed assessment breakdowns — link to the structured data instead
- Don't include the governance criteria definitions — the reviewer already knows them

## Rules

- Keep language neutral and evidence-based. No advocacy — present facts and let the council decide.
- If data collection had errors for a package, flag this clearly in the report (e.g., "⚠ Metrics incomplete — {N} collection errors").
- If no packages have proposed changes, say so explicitly: "No tag changes proposed this review cycle."
- Same for renewals and warnings — always show the section header even if empty, with a clear "None" message.
