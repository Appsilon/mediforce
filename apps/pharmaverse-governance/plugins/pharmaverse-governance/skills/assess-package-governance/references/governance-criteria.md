# Pharmaverse Governance Criteria Reference

Complete criteria specification with stable IDs and measurable thresholds.

## Status Tags

### Stable (ST)
| ID | Criterion | Measurable |
|----|-----------|------------|
| ST-1 | Settled, production-ready API — no major breaking changes expected in current term | Check releases.majorBumps is empty |
| ST-2 | Actively responding: critical issues ≤30 days, non-critical ≤90 days | issues.criticalResponseMedianDays ≤ 30, issues.nonCriticalTriageMedianDays ≤ 90 |
| ST-3 | At least one release within current 18-month endorsement term | releases.countLast18Months ≥ 1 |
| ST-4 | All three quality badge dimensions actively assessed | All badges non-null |
| ST-5 | Documentation current with latest release | documentation.hasManPages && documentation.usesRoxygen |

### Maturing (MA)
| ID | Criterion | Measurable |
|----|-----------|------------|
| MA-1 | Approved through RFC with signed Maintainer Covenant | currentState.governanceStatus == "Maturing" |
| MA-2 | Under active development | contributors.commitsLast90Days > 0 |
| MA-3 | Submission-Suitability NOT assessed | Output "Not Assessed" for submission readiness |
| MA-4 | Maintenance Health and Technical Quality reflect current state | Assess AM/QR criteria |
| MA-5 | Must achieve Quality Reviewed within 12 months of entry | Check endorsementTermStart + 12 months |

### Watch (WA)
| ID | Criterion | Notes |
|----|-----------|-------|
| WA-1 | Documented concern raised | Propose based on evidence; council votes |
| WA-2 | Placed by majority council vote | Cannot be auto-assigned |
| WA-3 | Maintainer team notified before public announcement | Process requirement |
| WA-4 | 30-day appeal window | Process requirement |

### At Risk (AR)
| ID | Criterion | Notes |
|----|-----------|-------|
| AR-1 | On Watch for ≥1 quarter with insufficient improvement | Check currentState + lastReviewDate |
| AR-2 | Placed by majority council vote | Cannot be auto-assigned |
| AR-3 | Remediation plan required within 1 quarter | Process requirement |
| AR-4 | 30-day appeal window | Process requirement |
| AR-5 | Council seeks steward if maintainer absent | Process requirement |

### Archived (AV)
| ID | Criterion | Notes |
|----|-----------|-------|
| AV-1 | Automatic: At Risk + no remediation plan by next review | Check timeline |
| AV-2 | Direct: 2/3 supermajority for egregious cases | Cannot be auto-assigned |
| AV-3 | No quality badges displayed | Output all badges as null |
| AV-4 | Retained for reference | No action needed |

## Quality Badges

### Dimension 1 — Submission Readiness (Stable only)

**Submission-Suitable (SS)**
| ID | Criterion | Measurable |
|----|-----------|------------|
| SS-1 | Validation artifacts: comprehensive test coverage, requirements traceability, risk assessment | coverage.percent ≥ 70, hasVignettes |
| SS-2 | CDISC compliance where relevant | Requires human judgment |
| SS-3 | Stability & versioning: semantic versioning, pinned dependencies, archived releases | releases data |
| SS-4 | Regulatory context awareness in documentation | Requires human judgment |

**Submission-Caution (SC)**
| ID | Criterion | Measurable |
|----|-----------|------------|
| SC-1 | Unvalidated — validation artifacts incomplete or absent | coverage.percent < 70 or !hasVignettes |
| SC-2 | Upstream dependency risks | Requires dependency analysis |
| SC-3 | Regulatory grey areas | Requires human judgment |

### Dimension 2 — Maintenance Health (all packages)

**Actively Maintained (AM)**
| ID | Criterion | Threshold |
|----|-----------|-----------|
| AM-1 | Critical issues acknowledged within 30 days | criticalResponseMedianDays ≤ 30 |
| AM-2 | Non-critical issues triaged within 90 days | nonCriticalTriageMedianDays ≤ 90 |
| AM-3 | At least one release per 18-month term | countLast18Months ≥ 1 |
| AM-4 | Breaking changes communicated with 2-quarter deprecation notice | Requires human judgment |
| AM-5 | Responsive to community questions and PRs | pullRequests.medianReviewTimeDays reasonable |

**Low Maintenance (LM)**
| ID | Criterion | Threshold |
|----|-----------|-----------|
| LM-1 | Response times exceed covenant thresholds | criticalResponseMedianDays > 30 OR nonCriticalTriageMedianDays > 90 |
| LM-2 | No release in current term or cadence significantly slowed | countLast18Months == 0 |
| LM-3 | Unresponsive to community | No PR reviews, no issue responses |
| LM-4 | May trigger proactive outreach | Early warning signal |

### Dimension 3 — Technical Quality (all packages)

**Quality Reviewed (QR)**
| ID | Criterion | Threshold |
|----|-----------|-----------|
| QR-0 | R CMD check: no errors or warnings | cranChecks.errorCount == 0 && cranChecks.warningCount == 0 |
| QR-1 | Test coverage ≥70% for core functionality | coverage.percent ≥ 70 |
| QR-2 | Vignettes demonstrating pharma use case | hasVignettes == true |
| QR-3 | Maintainable code: clear structure, consistent style | Requires human judgment |
| QR-4 | Documentation covers all exported functions | documentation.hasManPages && documentation.usesRoxygen |

**Review Pending (RP)**
| ID | Criterion | Notes |
|----|-----------|-------|
| RP-1 | Expected initial state for Maturing | Not a concern |
| RP-2 | Long-standing for Stable is a concern | Flag if Stable + Review Pending for >1 term |
| RP-3 | Multiple terms without progress grounds for non-renewal | Flag at renewal |

## Renewal

### Triggers
| ID | Trigger | Check |
|----|---------|-------|
| RT-1 | 18-month calendar limit | endorsementTermStart + 18 months ≤ today |
| RT-2 | Major version release | releases.majorBumps not empty since last review |
| RT-3 | Council-initiated | Flag based on evidence severity |

### Assessment Dimensions
| ID | Dimension | Data-driven? |
|----|-----------|-------------|
| RC-1 | Value proposition still holds | Partially (competing packages) — mostly council judgment |
| RC-2 | Maintenance covenant met | Yes — AM criteria |
| RC-3 | Quality badges trajectory | Yes — compare current vs previous |
| RC-4 | User adoption evidence | Partially (commits, PRs, stars) — mostly council judgment |

### Outcomes
| ID | Outcome | Vote |
|----|---------|------|
| RO-1 | Renewed (new 18-month term) | Majority |
| RO-2 | Renewed with conditions (1 quarter) | Majority |
| RO-3 | Grace period (Watch + remediation) | Majority |
| RO-4 | Endorsement withdrawn (Archived) | 2/3 supermajority |
