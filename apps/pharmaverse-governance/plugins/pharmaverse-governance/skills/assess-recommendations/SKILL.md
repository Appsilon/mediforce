---
name: assess-recommendations
description: Turn deterministic package classifications plus raw metrics into concise council recommendations and interpretive flags. Does not compute or change status or badges.
---

# Assess Recommendations

The status tags, quality badges, per-criterion evidence, renewal triggers, and
factual early warnings have **already been computed deterministically** in the
`classify-packages` step. Your job is the judgment layer only: for each package,
write short, actionable **council recommendations** and any **interpretive
flags** a human reviewer should see. You MUST NOT recompute or contradict the
classification — treat status and badges as fixed inputs.

## Input

Read `/output/input.json`. It contains a compact digest under `packages` (also
available at `steps["digest-packages"].packages`) — one entry per package with:
- `packageName`, `status`, `changeType`
- `badges` — `{ submission, maintenance, technical }`
- `earlyWarnings`, `dataGaps`, `renewalTriggers`
- `metrics` — headline numbers: `cranStatus`, `releasesLast18Months`,
  `openIssues`, `unresolvedCritical`, `oldestUnresolvedDays`, `coveragePercent`,
  `commitsLast90Days`

This digest is the complete set of facts available to you — the full evidence
lives elsewhere and is not needed here.

## Task

For each package, produce:
- **recommendations**: 0–3 short imperative sentences for the council
  (e.g. "Assign maintainer outreach — 8 unresolved critical issues.",
  "Confirm CRAN submission readiness before endorsing as Submission-Suitable.").
  Base them on the classification: Low Maintenance, Review Pending, non-empty
  `earlyWarnings`, fired `renewalTriggers`, or notable `dataGaps`. A healthy
  package with no concerns gets an empty list.
- **flags**: 0–2 short interpretive notes needing human attention that are NOT
  already stated as an early warning (e.g. "Active development but no CRAN
  release — monitor for maturation."). Empty when nothing applies.

Rules:
- Be terse. One sentence per item. No narrative paragraphs, no restating metrics
  the report already shows.
- Do not invent data. Only reference values present in the input.
- Never output status or badge values — those belong to `classify-packages`.

## Output

Write `/output/result.json` with exactly this shape (keep it compact — one entry
per package, only packages that have at least one recommendation or flag may be
included; packages with none can be omitted):

```json
{
  "summary": "Recommendations for N packages",
  "recommendations": [
    {
      "packageName": "aNCA",
      "recommendations": ["Assign maintainer outreach — 8 unresolved critical issues."],
      "flags": ["Active development but not yet released to CRAN — monitor for maturation."]
    }
  ]
}
```
