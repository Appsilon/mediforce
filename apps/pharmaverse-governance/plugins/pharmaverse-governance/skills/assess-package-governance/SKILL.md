---
name: assess-package-governance
description: Assess pharmaverse R packages against governance criteria and propose status tags, quality badges, and council action items
---

# Assess Package Governance Status

You are given per-package metrics collected from the pharmaverse GitHub org and CRAN. Your job is to apply the pharmaverse governance criteria systematically to each package and produce a structured assessment.

## Task

For each package in the input:

1. **Evaluate the current governance status tag** against the criteria
2. **Assess all three quality badge dimensions**
3. **Check renewal triggers**
4. **Compare proposed state against current state** to detect changes
5. **Flag items requiring council attention**

## Input

The input is a JSON object with a `packages` array. Each package has:
- `packageName`, `repo`, `repoUrl` — identity
- `currentState` — current governance properties from GitHub (may be null if first review)
- `releases` — release dates, counts, major bumps
- `issues` — response times, open/closed counts
- `pullRequests` — PR activity
- `cranChecks` — R CMD check results from CRAN
- `cranStatus` — whether published on CRAN
- `coverage` — test coverage percentage
- `hasVignettes` — boolean
- `documentation` — man pages, roxygen usage
- `contributors` — counts and commit activity
- `errors` — any data collection errors (assess with available data, flag gaps)

## Assessment Process

### Step 1: Status Tag Assessment

Walk through the criteria for each status level. The tag should reflect the **most accurate description** of the package's current state.

**Stable (ST-1..ST-5):**
- ST-1: Settled, production-ready API — no major breaking changes expected
- ST-2: Actively responding to issues (critical ≤30 days, non-critical ≤90 days)
- ST-3: At least one release within the current 18-month endorsement term
- ST-4: All three quality badge dimensions actively assessed
- ST-5: Documentation current with latest release

**Maturing (MA-1..MA-5):**
- MA-1: Approved through RFC, signed Maintainer Covenant
- MA-2: Under active development (commits, issues addressed, releases)
- MA-3: Submission-Suitability NOT assessed at this stage
- MA-4: Maintenance Health and Technical Quality reflect current state
- MA-5: Must achieve Quality Reviewed within 12 months of entry

**Watch (WA-1..WA-4):**
- WA-1: Documented concern raised (maintenance gap, quality decline, value doubt)
- WA-2: Placed by majority council vote
- WA-3: Maintainer team notified before public announcement
- WA-4: 30-day appeal window

**At Risk (AR-1..AR-5):**
- AR-1: On Watch for at least one quarter with insufficient improvement
- AR-2: Placed by majority council vote
- AR-3: Must submit remediation plan within one quarter
- AR-4: 30-day appeal window
- AR-5: Council seeks steward if maintainer absent

**Archived (AV-1..AV-4):**
- AV-1: Automatic if At Risk with no remediation plan by next review
- AV-2: Direct path via 2/3 supermajority for egregious cases
- AV-3: No quality badges displayed
- AV-4: Retained for reference

**Important**: You can only **propose** a tag. You cannot place Watch, At Risk, or Archived — those require council votes. Instead, flag packages where the evidence suggests a status change is warranted and present the evidence for the council.

### Step 2: Quality Badge Assessment

Assess each dimension independently:

**Dimension 1 — Submission Readiness** (Stable packages only):
- Submission-Suitable: SS-1 (validation artifacts), SS-2 (CDISC compliance), SS-3 (versioning stability), SS-4 (regulatory context awareness)
- Submission-Caution: SC-1 (unvalidated), SC-2 (dependency risks), SC-3 (regulatory grey areas)
- For Maturing packages: output "Not Assessed"

**Dimension 2 — Maintenance Health** (all packages):
- Actively Maintained: AM-1 (critical issues ≤30d), AM-2 (non-critical ≤90d), AM-3 (≥1 release per term), AM-4 (2-quarter deprecation notice), AM-5 (responsive to community)
- Low Maintenance: LM-1 (response times exceed thresholds), LM-2 (no releases in term), LM-3 (unresponsive), LM-4 (may trigger proactive outreach)

**Dimension 3 — Technical Quality** (all packages):
- Quality Reviewed: QR-0 (R CMD check clean), QR-1 (coverage ≥70%), QR-2 (vignettes present), QR-3 (maintainable code), QR-4 (documentation current)
- Review Pending: RP-1 (expected for Maturing), RP-2 (concern if long-standing for Stable), RP-3 (multiple terms without progress grounds for non-renewal)

### Step 3: Renewal Trigger Check

- RT-1: Is the package past its 18-month endorsement term? (Check `endorsementTermStart` + 18 months vs today)
- RT-2: Has there been a major version release since last review? (Check `releases.majorBumps`)
- RT-3: Are there credible concerns warranting council-initiated review?

If any trigger fires, include a renewal assessment section evaluating:
- RC-1: Value proposition (does the gap still exist? — flag this as requiring human judgment)
- RC-2: Maintenance covenant (data-driven from metrics)
- RC-3: Quality badges (compare trajectory)
- RC-4: User adoption (community engagement, commit trends — partially data-driven)

### Step 4: Change Detection

Compare proposed tags/badges against `currentState`:
- If any tag or badge would change, mark as "proposed-change"
- If this is the first review (currentState fields are null), mark as "initial-assessment"
- Healthy packages with no changes go to "consent-agenda"

### Step 5: Confidence and Data Gaps

For each assessment, indicate confidence:
- **high**: All relevant metrics available, clear criteria match
- **medium**: Some metrics missing but enough for reasonable assessment
- **low**: Significant data gaps, assessment is tentative

List specific data gaps (e.g., "coverage unknown", "no CRAN check data").

## Output Format

Write a JSON file to `/output/result.json` with this structure:

```json
{
  "output_file": "/output/result.json",
  "summary": "Assessed N packages: X consent agenda, Y proposed changes, Z renewals due"
}
```

The result.json must contain:

```json
{
  "assessments": [
    {
      "packageName": "admiral",
      "repo": "admiral",
      "repoUrl": "https://github.com/pharmaverse/admiral",

      "proposedStatus": "Stable",
      "statusEvidence": [
        { "criteriaId": "ST-1", "met": true, "evidence": "No major version bump in current term" },
        { "criteriaId": "ST-2", "met": true, "evidence": "Median critical issue response: 5 days" }
      ],

      "proposedBadges": {
        "submissionReadiness": "Suitable",
        "maintenanceHealth": "Actively Maintained",
        "technicalQuality": "Quality Reviewed"
      },
      "badgeEvidence": {
        "submissionReadiness": [
          { "criteriaId": "SS-1", "met": true, "evidence": "Comprehensive test suite, 87% coverage" }
        ],
        "maintenanceHealth": [
          { "criteriaId": "AM-1", "met": true, "evidence": "Median critical response: 5 days (threshold: 30)" }
        ],
        "technicalQuality": [
          { "criteriaId": "QR-0", "met": true, "evidence": "CRAN checks: 12 OK, 0 errors, 0 warnings" }
        ]
      },

      "renewalTriggers": {
        "rt1_termExpired": false,
        "rt2_majorRelease": false,
        "rt3_councilInitiated": false
      },
      "renewalAssessment": null,

      "changeType": "consent-agenda",
      "previousState": {
        "governanceStatus": "Stable",
        "submissionReadiness": "Suitable",
        "maintenanceHealth": "Actively Maintained",
        "technicalQuality": "Quality Reviewed"
      },
      "proposedChanges": [],

      "confidence": "high",
      "dataGaps": [],
      "flags": [],
      "earlyWarnings": [],

      "report": "## admiral\n\n**Status: Stable** (no change)\n..."
    }
  ],
  "summary": {
    "totalPackages": 40,
    "consentAgenda": 32,
    "proposedChanges": 5,
    "renewalsDue": 3,
    "earlyWarnings": 4,
    "initialAssessments": 2
  },
  "assessedAt": "2026-04-01T08:30:00Z"
}
```

## Rules

- Be conservative: the default is **no change**. Only propose a status change when evidence is clear.
- Reference specific criteria IDs in all evidence (e.g., "AM-1: critical response median 5 days vs 30-day threshold").
- Clearly distinguish data-driven assessments from items requiring human judgment.
- For RC-1 (value proposition) and RC-4 (adoption evidence), flag as "requires-council-judgment" rather than making unsupported claims.
- If a package has data collection errors, note them as data gaps but still assess with available information.
- Generate a markdown report per package suitable for human review.
- The report should be concise but include all evidence needed for council decision-making.

## Reference

See `references/governance-criteria.md` for the complete criteria specification with all IDs and thresholds.
