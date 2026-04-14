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
4. If all action items are resolved, the report should clearly state "All items resolved — ready for final approval"

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

The `councilDecisions` array tracks decisions made across revision cycles:
```json
{
  "councilDecisions": [
    {
      "packageName": "admiral",
      "decision": "Status approved as Stable",
      "decidedAt": "2026-04-14",
      "source": "Council revision comment"
    }
  ]
}
```

## Output 2: presentation.html

Write a self-contained HTML file to `/output/presentation.html`. This file is rendered in a sandboxed iframe within the Mediforce review UI.

### Design Principles

1. **Collapsible sections** — Every major section (Criteria Reference, Consent Agenda, each proposed change, each warning) must be collapsible via `<details><summary>`. Sections with pending actions should be open by default; resolved sections collapsed.
2. **Criteria reference at top** — A collapsed-by-default section explaining all governance criteria codes (ST-1..5, MA-1..5, AM-1..5, etc.) for quick lookup.
3. **Lead with numbers** — Overview stat cards at top.
4. **Status badges** — Colored inline badges for status tags.
5. **Quantitative evidence** — "Critical issue response: 45d (threshold: 30d)" not "Issues are slow".
6. **Decision tracking** — Resolved items show a green "Decided" badge; pending items show amber "Pending vote".
7. **Links to GitHub** — Package names link to repos.

### HTML Template

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; color: #1a1a2e; background: #fff; padding: 2rem; max-width: 900px; margin: 0 auto; line-height: 1.6; }
    h1 { font-size: 1.5rem; font-weight: 700; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem; margin-bottom: 1.5rem; }
    h2 { font-size: 1.15rem; font-weight: 600; color: #334155; margin-top: 2rem; margin-bottom: 0.75rem; }

    /* Overview grid */
    .overview-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 0.75rem; margin-bottom: 2rem; }
    .stat-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.75rem; text-align: center; }
    .stat-value { font-size: 1.75rem; font-weight: 700; }
    .stat-label { font-size: 0.7rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }

    /* Collapsible sections */
    details { border: 1px solid #e2e8f0; border-radius: 8px; margin: 0.75rem 0; overflow: hidden; }
    details > summary { padding: 0.75rem 1rem; cursor: pointer; font-weight: 600; font-size: 0.95rem; background: #f8fafc; user-select: none; display: flex; align-items: center; gap: 0.5rem; }
    details > summary:hover { background: #f1f5f9; }
    details > summary::marker { content: ''; }
    details > summary::before { content: '▶'; font-size: 0.65rem; transition: transform 0.2s; color: #94a3b8; }
    details[open] > summary::before { transform: rotate(90deg); }
    details > .content { padding: 0.75rem 1rem; }
    details.criteria-ref { border-color: #cbd5e1; }
    details.criteria-ref > summary { background: #f1f5f9; font-size: 0.85rem; color: #475569; }

    /* Badges */
    .badge { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 9999px; font-size: 0.7rem; font-weight: 600; vertical-align: middle; }
    .badge-stable { background: #dcfce7; color: #166534; }
    .badge-maturing { background: #dbeafe; color: #1e40af; }
    .badge-watch { background: #fef3c7; color: #92400e; }
    .badge-at-risk { background: #fee2e2; color: #991b1b; }
    .badge-archived { background: #f1f5f9; color: #475569; }
    .badge-decided { background: #dcfce7; color: #166534; }
    .badge-pending { background: #fef3c7; color: #92400e; }
    .badge-count { background: #e2e8f0; color: #475569; font-size: 0.7rem; padding: 0.05rem 0.4rem; border-radius: 9999px; margin-left: 0.5rem; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin: 0.5rem 0; }
    th { text-align: left; padding: 0.4rem 0.6rem; background: #f8fafc; border-bottom: 2px solid #e2e8f0; font-weight: 600; color: #475569; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.025em; }
    td { padding: 0.4rem 0.6rem; border-bottom: 1px solid #f1f5f9; }
    tr:hover td { background: #f8fafc; }

    /* Change cards */
    .evidence { font-size: 0.82rem; color: #475569; margin: 0.5rem 0; }
    .evidence strong { color: #1e293b; }
    .criteria-code { font-family: monospace; font-size: 0.72rem; background: #f1f5f9; padding: 0.1rem 0.35rem; border-radius: 4px; color: #475569; }
    .recommendation { background: #f0fdf4; border-left: 3px solid #22c55e; padding: 0.5rem 0.75rem; margin: 0.5rem 0; font-size: 0.85rem; border-radius: 0 6px 6px 0; }
    .recommendation.caution { background: #fffbeb; border-left-color: #f59e0b; }
    .recommendation.alert { background: #fef2f2; border-left-color: #ef4444; }
    .decision-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 0.75rem 1rem; margin: 0.5rem 0; }
    .decision-box .label { font-size: 0.7rem; text-transform: uppercase; color: #16a34a; font-weight: 600; letter-spacing: 0.05em; }

    /* Links */
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .divider { border: none; border-top: 1px solid #e2e8f0; margin: 1.5rem 0; }

    /* Dark mode */
    @media (prefers-color-scheme: dark) {
      body { color: #e2e8f0; background: #0f172a; }
      h2 { color: #cbd5e1; }
      .stat-card, details > summary { background: #1e293b; border-color: #334155; }
      .stat-label { color: #94a3b8; }
      details { border-color: #334155; }
      details > summary:hover { background: #334155; }
      th { background: #1e293b; color: #94a3b8; border-color: #334155; }
      td { border-color: #1e293b; }
      tr:hover td { background: #1e293b; }
      .criteria-code { background: #334155; color: #94a3b8; }
      .evidence { color: #94a3b8; }
      .evidence strong { color: #e2e8f0; }
      .recommendation { background: #0a1f0a; }
      .recommendation.caution { background: #1a1500; }
      .recommendation.alert { background: #1a0505; }
      .decision-box { background: #0a1f0a; border-color: #166534; }
      a { color: #60a5fa; }
      .divider { border-color: #334155; }
      .badge-count { background: #334155; color: #94a3b8; }
    }
  </style>
</head>
<body>

  <h1>{title}</h1>

  <!-- Criteria Reference (collapsed by default) -->
  <details class="criteria-ref">
    <summary>Governance Criteria Reference</summary>
    <div class="content">
      <h3 style="margin-top:0.5rem">Status Tags</h3>
      <table>
        <tr><th>Code</th><th>Criteria</th></tr>
        <tr><td><span class="criteria-code">ST-1</span></td><td>Settled, production-ready API — no major breaking changes expected</td></tr>
        <tr><td><span class="criteria-code">ST-2</span></td><td>Actively responding to issues (critical ≤30d, non-critical ≤90d)</td></tr>
        <tr><td><span class="criteria-code">ST-3</span></td><td>At least one release within the current 18-month endorsement term</td></tr>
        <tr><td><span class="criteria-code">ST-4</span></td><td>All three quality badge dimensions actively assessed</td></tr>
        <tr><td><span class="criteria-code">ST-5</span></td><td>Documentation current with latest release</td></tr>
        <tr><td><span class="criteria-code">MA-1..5</span></td><td>Maturing: Approved via RFC, under active development, Quality Reviewed within 12mo target</td></tr>
        <tr><td><span class="criteria-code">WA-1..4</span></td><td>Watch: Documented concern, majority vote, 30-day appeal window</td></tr>
        <tr><td><span class="criteria-code">AR-1..5</span></td><td>At Risk: Failing after ≥1 Watch quarter, remediation plan required</td></tr>
        <tr><td><span class="criteria-code">AV-1..4</span></td><td>Archived: Endorsement withdrawn (automatic or 2/3 supermajority)</td></tr>
      </table>

      <h3>Quality Badges</h3>
      <table>
        <tr><th>Code</th><th>Criteria</th></tr>
        <tr><td><span class="criteria-code">SS-1..4</span></td><td>Submission-Suitable: Validation artifacts, CDISC compliance, stability, regulatory context</td></tr>
        <tr><td><span class="criteria-code">SC-1..3</span></td><td>Submission-Caution: Unvalidated, dependency risks, regulatory grey areas</td></tr>
        <tr><td><span class="criteria-code">AM-1..5</span></td><td>Actively Maintained: Issues ≤30/90d, ≥1 release/term, deprecation notice, docs current</td></tr>
        <tr><td><span class="criteria-code">LM-1..4</span></td><td>Low Maintenance: Response times exceed thresholds, no releases, unresponsive</td></tr>
        <tr><td><span class="criteria-code">QR-0..4</span></td><td>Quality Reviewed: R CMD check clean, coverage ≥70%, vignettes, documentation current</td></tr>
        <tr><td><span class="criteria-code">RP-1..3</span></td><td>Review Pending: Expected for Maturing; concern if long-standing for Stable</td></tr>
      </table>

      <h3>Renewal Triggers</h3>
      <table>
        <tr><th>Code</th><th>Trigger</th></tr>
        <tr><td><span class="criteria-code">RT-1</span></td><td>18-month calendar limit</td></tr>
        <tr><td><span class="criteria-code">RT-2</span></td><td>Major version release (breaking API change)</td></tr>
        <tr><td><span class="criteria-code">RT-3</span></td><td>Council-initiated (credible concerns)</td></tr>
      </table>
    </div>
  </details>

  <!-- Overview stats -->
  <div class="overview-grid">
    <div class="stat-card">
      <div class="stat-value">{totalPackages}</div>
      <div class="stat-label">Packages</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:#16a34a">{consentAgendaCount}</div>
      <div class="stat-label">Consent</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:#d97706">{proposedChangesCount}</div>
      <div class="stat-label">Changes</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:#dc2626">{earlyWarningsCount}</div>
      <div class="stat-label">Warnings</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:#16a34a">{resolvedDecisions}</div>
      <div class="stat-label">Resolved</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:#d97706">{pendingDecisions}</div>
      <div class="stat-label">Pending</div>
    </div>
  </div>

  <hr class="divider">

  <!-- Section: Council Decisions (if any revisions have been made) -->
  <!-- Show only after first revision. Each decision as a .decision-box -->

  <!-- Section: Consent Agenda (collapsible, collapsed by default) -->
  <details>
    <summary>Consent Agenda <span class="badge-count">{N}</span></summary>
    <div class="content">
      <p style="font-size:0.82rem;color:#64748b">No discussion needed — ratified as-is.</p>
      <table>
        <thead><tr><th>Package</th><th>Status</th><th>Maintenance</th><th>Quality</th></tr></thead>
        <tbody><!-- rows --></tbody>
      </table>
    </div>
  </details>

  <!-- Section: Proposed Changes (one <details> per package, open if pending) -->
  <h2>Proposed Changes</h2>
  <details open>
    <summary>
      <a href="{repoUrl}" target="_blank">{packageName}</a>: {current} → {proposed}
      <span class="badge badge-pending">Pending vote</span>
    </summary>
    <div class="content">
      <div class="evidence">
        <!-- Evidence items with criteria codes -->
      </div>
      <div class="recommendation caution">
        <strong>Recommendation:</strong> {action}
      </div>
    </div>
  </details>

  <!-- For decided items: -->
  <details>
    <summary>
      <a href="{repoUrl}" target="_blank">{packageName}</a>: {decision}
      <span class="badge badge-decided">Decided</span>
    </summary>
    <div class="content">
      <div class="decision-box">
        <div class="label">Council Decision</div>
        <p>{decision text}</p>
      </div>
    </div>
  </details>

  <hr class="divider">

  <!-- Section: Early Warnings (collapsible) -->
  <details>
    <summary>Early Warnings <span class="badge-count">{N}</span></summary>
    <div class="content"><!-- warning cards --></div>
  </details>

  <hr class="divider">

  <!-- Section: Action Items (only pending items) -->
  <h2>Pending Action Items</h2>
  <!-- If none: "All items resolved — ready for final approval" in green -->
  <!-- Otherwise: numbered list of pending actions -->

</body>
</html>
```

### Section Behavior Rules

- **Criteria Reference**: Always collapsed by default. Never remove it.
- **Consent Agenda**: Collapsed by default. Shows count in badge.
- **Proposed Changes**: One `<details>` per package. **Open if pending**, collapsed if decided.
- **Early Warnings**: Collapsed by default.
- **Council Decisions**: Only shown after first revision. Lists all decisions made so far.
- **Pending Action Items**: Always visible. When empty, show: `<div class="recommendation">All items resolved — ready for final approval.</div>`

### Handling Revision Cycles

When the input contains `verdict: "revise"` and a `comment`:

1. **Parse the comment** — Extract decisions like "admiral approved", "rhino option A", "confirmed compliance"
2. **Update the report** — Move decided items from "pending" to "decided" with green badge
3. **Track decisions** — Add to `councilDecisions` array in result.json
4. **Update counts** — Decrease `pendingDecisions`, increase `resolvedDecisions`
5. **Check completion** — If `pendingDecisions === 0`, show "All items resolved" message prominently

The council will iterate: revise with decisions → report updates → approve when done.

## Rules

- Keep language neutral and evidence-based. No advocacy.
- If data collection had errors, flag clearly: "⚠ Metrics incomplete — N collection errors"
- Always show section headers even when empty (with "None" message)
- Ensure the HTML is fully self-contained (no external resources)
- Keep the HTML under 200KB
