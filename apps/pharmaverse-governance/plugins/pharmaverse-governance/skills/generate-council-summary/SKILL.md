---
name: generate-council-summary
description: Aggregate approved package assessments into a structured council meeting summary with consent agenda, action items, and renewal assessments
---

# Generate Council Summary

You are given the approved package assessment results from the pharmaverse governance review. Your job is to aggregate them into a structured council meeting document.

## Task

Produce a council-ready summary document organized for efficient decision-making during the semiannual review meeting. The document should minimize discussion time for healthy packages and focus council attention on packages requiring action.

## Input

The input is the approved assessment output from the `assess-packages` step. It contains:
- `assessments` array — per-package assessment with proposed status, badges, evidence, flags
- `summary` — counts of consent agenda, proposed changes, renewals, warnings

## Output Format

Write a JSON file to `/output/result.json` with this structure:

```json
{
  "output_file": "/output/result.json",
  "summary": "Council summary: N consent, X changes, Y renewals, Z warnings"
}
```

The result.json must contain:

```json
{
  "councilSummary": {
    "title": "Pharmaverse Semiannual Governance Review — April 2026",
    "reviewDate": "2026-04-01",
    "overview": {
      "totalPackages": 40,
      "consentAgendaCount": 32,
      "proposedChangesCount": 5,
      "renewalsDueCount": 3,
      "earlyWarningsCount": 4,
      "estimatedMeetingMinutes": 90
    },

    "consentAgenda": {
      "description": "Packages with no proposed changes. Ratified as-is by consent.",
      "packages": [
        { "name": "admiral", "status": "Stable", "badges": "AM+QR+SS" }
      ]
    },

    "proposedTagChanges": [
      {
        "packageName": "examplePkg",
        "currentStatus": "Stable",
        "proposedStatus": "Watch",
        "voteRequired": "majority",
        "evidenceSummary": "No releases in 14 months (AM-3). Critical issue response median 45 days (AM-1 threshold: 30 days).",
        "criteriaRefs": ["AM-1", "AM-3"],
        "recommendedAction": "Vote to place on Watch. Notify maintainer team before public announcement (WA-3).",
        "fullEvidence": "..."
      }
    ],

    "renewalAssessments": [
      {
        "packageName": "examplePkg2",
        "triggerType": "RT-1 (18-month term expired)",
        "currentStatus": "Stable",
        "assessment": {
          "rc1_valueProposition": { "verdict": "requires-council-judgment", "notes": "3 competing packages now exist in this space" },
          "rc2_maintenanceCovenant": { "verdict": "met", "evidence": "All AM criteria passing" },
          "rc3_qualityBadges": { "verdict": "improved", "evidence": "Coverage increased 65% → 82%" },
          "rc4_userAdoption": { "verdict": "requires-council-judgment", "notes": "Downloads stable but community engagement declining" }
        },
        "recommendedOutcome": "RO-1: Renewed",
        "voteRequired": "majority"
      }
    ],

    "earlyWarnings": [
      {
        "packageName": "examplePkg3",
        "currentStatus": "Stable",
        "concern": "Issue response times trending upward (15 days → 25 days over last 6 months). Not yet exceeding AM-1 threshold but approaching.",
        "recommendedAction": "Assign proactive outreach to maintainer team."
      }
    ],

    "actionItems": [
      {
        "type": "vote",
        "description": "Vote on Watch designation for examplePkg",
        "threshold": "majority",
        "assignee": "all-council"
      },
      {
        "type": "outreach",
        "description": "Contact examplePkg3 maintainer team about rising response times",
        "assignee": "to-be-assigned"
      },
      {
        "type": "renewal-vote",
        "description": "Renewal assessment for examplePkg2 (18-month term expired)",
        "threshold": "majority",
        "assignee": "all-council"
      }
    ],

    "pipelineUpdate": {
      "packagesInRFC": [],
      "recentEntries": [],
      "upcomingRenewals": []
    }
  },

  "report": "# Pharmaverse Semiannual Governance Review — April 2026\n\n## Overview\n...",

  "generatedAt": "2026-04-01T09:00:00Z"
}
```

## Report Structure (Markdown)

The `report` field should be a complete markdown document following this structure:

```markdown
# Pharmaverse Semiannual Governance Review — {Month Year}

## Overview
- **Total packages reviewed**: N
- **Consent agenda**: N (no discussion needed)
- **Proposed tag changes**: N (votes required)
- **Renewals due**: N
- **Early warnings**: N
- **Estimated meeting time**: ~N minutes

---

## 1. Consent Agenda (~5 min)

All packages below have no proposed changes and are ratified as-is by consent.

| Package | Status | Maintenance | Quality | Submission |
|---------|--------|-------------|---------|------------|
| admiral | Stable | Actively Maintained | Quality Reviewed | Suitable |
| ...     | ...    | ...         | ...     | ...        |

---

## 2. Proposed Tag Changes (discussion + vote)

### 2.1 {packageName}: {currentStatus} → {proposedStatus}

**Evidence:**
- {criteriaId}: {specific evidence with numbers}
- ...

**Vote required:** {majority/supermajority}
**Recommended action:** {specific action}

---

## 3. Renewal Assessments

### 3.1 {packageName} — {triggerType}

| Dimension | Assessment | Evidence |
|-----------|-----------|----------|
| RC-1: Value proposition | {verdict} | {notes} |
| RC-2: Maintenance covenant | {verdict} | {evidence} |
| RC-3: Quality badges | {verdict} | {evidence} |
| RC-4: User adoption | {verdict} | {notes} |

**Recommended outcome:** {RO-1/RO-2/RO-3/RO-4}
**Vote required:** {threshold}

---

## 4. Early Warnings

| Package | Current Status | Concern | Recommended Action |
|---------|---------------|---------|-------------------|
| ...     | ...           | ...     | ...               |

---

## 5. Action Items

- [ ] {action item with assignee}
- ...

---

## 6. Pipeline & Stewardship

- Packages in RFC: {list or "none"}
- Recent entries: {list or "none"}
- Upcoming renewals (next 6 months): {list}
```

## Rules

- The consent agenda section should be a compact table — no detailed discussion per package.
- Proposed tag changes must include specific criteria IDs and quantitative evidence.
- For renewal assessments, clearly mark which dimensions require council judgment vs which are data-driven.
- Action items must be specific and actionable — include vote threshold, who is responsible, and what the next step is.
- Early warnings are informational, not actionable — they guide proactive outreach, not formal votes.
- Meeting time estimates: ~5 min for consent agenda, ~10 min per proposed tag change, ~15 min per renewal assessment, ~15 min for pipeline/stewardship.
- Keep the language neutral and evidence-based. No advocacy — present facts and let the council decide.

## Reference

See `references/council-report-template.md` for an example report structure.
